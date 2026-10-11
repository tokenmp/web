import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, num, parsePaging } from "~/lib/http";
import { plans, subscriptions, users } from "~/lib/schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const SCALE = 10 ** 8;

/**
 * GET /api/admin/plan-activations
 *
 * 按用户聚合的激活列表。
 *
 * 聚合放在 JS 里做而不是 SQL：每组的「当前额度」要取活跃且 period_end 最晚的那一行，
 * 用窗口函数或者嵌套子查询在 drizzle 里都不好写，而本地数据量很小，
 * 一次全量读进来分组反而更直观。
 *
 * 筛选语义：
 *   user_id  只看这个用户
 *   plan_id  只看订阅过这个套餐的用户（不影响该用户 total_spend 的口径，仍是全部订阅之和）
 *   expire   只有 7d 与 expired 生效，其余值静默忽略（openapi 明说）
 *           7d    = 当前订阅 period_end 在未来 7 天内且未过期
 *           expired = 当前订阅 period_end 已过
 */
export async function GET({ request }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const url = new URL(request.url);
  const { size, offset } = parsePaging(url);

  const userIdRaw = Number(url.searchParams.get("user_id"));
  const planIdRaw = Number(url.searchParams.get("plan_id"));
  const hasUser = Number.isFinite(userIdRaw) && userIdRaw > 0;
  const hasPlan = Number.isFinite(planIdRaw) && planIdRaw > 0;

  const expireRaw = url.searchParams.get("expire");
  const expire = expireRaw === "7d" || expireRaw === "expired" ? expireRaw : null;

  const rows = await db
    .select({
      userId: subscriptions.userId,
      planId: subscriptions.planId,
      amount: subscriptions.amount,
      quotaKind: subscriptions.quotaKind,
      quotaLimit: subscriptions.quotaLimit,
      quotaUsed: subscriptions.quotaUsed,
      periodStart: subscriptions.periodStart,
      periodEnd: subscriptions.periodEnd,
      status: subscriptions.status,
      createdAt: subscriptions.createdAt,
      userName: users.name,
      planName: plans.name,
      planMode: plans.mode,
    })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .innerJoin(plans, eq(plans.id, subscriptions.planId));

  type Row = (typeof rows)[number];

  const groups = new Map<number, Row[]>();
  for (const row of rows) {
    const list = groups.get(row.userId);
    if (list) list.push(row);
    else groups.set(row.userId, [row]);
  }

  /** 当前额度：活跃且 period_end 最晚的那行；没有活跃的退到 period_end 最晚，再退到最近创建 */
  function pickCurrent(list: Row[]) {
    let best: Row | null = null;
    for (const row of list) {
      if (row.status !== "active" || !row.periodEnd) continue;
      if (!best || row.periodEnd.getTime() > best.periodEnd!.getTime()) best = row;
    }
    if (best) return best;
    for (const row of list) {
      if (!row.periodEnd) continue;
      if (!best || row.periodEnd.getTime() > best.periodEnd!.getTime()) best = row;
    }
    if (best) return best;
    return list.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  }

  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * DAY_MS);

  const items: Array<{
    user_id: number;
    user_name: string;
    plan_id: number;
    plan_name: string;
    plan_mode: string;
    quota_kind: string;
    quota_limit: number;
    quota_used: number;
    period_start: Date | null;
    period_end: Date | null;
    total_spend: number;
    activation_count: number;
    first_at: Date | null;
  }> = [];

  for (const list of groups.values()) {
    const head = list[0];
    if (hasUser && head.userId !== userIdRaw) continue;
    if (hasPlan && !list.some(row => row.planId === planIdRaw)) continue;

    const current = pickCurrent(list);
    const periodEnd = current.periodEnd;
    if (expire === "7d" && !(periodEnd && periodEnd > now && periodEnd <= in7)) continue;
    if (expire === "expired" && !(periodEnd && periodEnd <= now)) continue;

    // 金额先乘 1e8 取整再累加，避免 68.1 + 128.2 这种浮点噪声
    let spendScaled = 0;
    let firstAt = head.createdAt;
    for (const row of list) {
      spendScaled += Math.round(num(row.amount) * SCALE);
      if (row.createdAt < firstAt) firstAt = row.createdAt;
    }

    items.push({
      user_id: head.userId,
      user_name: head.userName,
      plan_id: current.planId,
      plan_name: current.planName,
      plan_mode: current.planMode,
      quota_kind: current.quotaKind,
      quota_limit: num(current.quotaLimit),
      quota_used: num(current.quotaUsed),
      period_start: current.periodStart,
      period_end: current.periodEnd,
      total_spend: spendScaled / SCALE,
      activation_count: list.length,
      first_at: firstAt,
    });
  }

  // 最近激活的排前面；时间相同时按 user_id 稳定排序
  items.sort((a, b) => {
    const at = a.first_at ? a.first_at.getTime() : 0;
    const bt = b.first_at ? b.first_at.getTime() : 0;
    if (at !== bt) return bt - at;
    return a.user_id - b.user_id;
  });

  return json({ items: items.slice(offset, offset + size), total: items.length });
}
