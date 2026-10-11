import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, num } from "~/lib/http";
import { decimal8 } from "~/lib/ledger";
import { userBudgets, users } from "~/lib/schema";
import { checkMoney } from "~/lib/validate";

const PERIODS = ["day", "week", "month"] as const;
type BudgetPeriod = (typeof PERIODS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

function parseId(raw: string | undefined) {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * 周期结束时间。day/week 按固定毫秒数往后推；
 * month 用「先落到 1 号、跳月、再补回日号」的算法，
 * 直接用 setUTCMonth 会让 1 月 31 日滚到 3 月 3 日。
 */
function periodEnd(period: BudgetPeriod, from: Date) {
  if (period === "day") return new Date(from.getTime() + DAY_MS);
  if (period === "week") return new Date(from.getTime() + 7 * DAY_MS);

  const end = new Date(from.getTime());
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 1);
  // 目标月的最后一天，用来把 31 号这类日号夹住
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}

type BudgetValues = {
  enabled: number;
  amount: unknown;
  period: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  used: unknown;
  version: number;
  updatedAt: Date;
};

/** 回给前端的预算形状。enabled 是库里的列，openapi 的 UserBudget 没写它，页面要用，这里带上 */
function budgetShape(userId: number, row: BudgetValues) {
  return {
    user_id: userId,
    enabled: row.enabled,
    amount: num(row.amount),
    period: row.period,
    period_start: row.periodStart,
    period_end: row.periodEnd,
    used: num(row.used),
    version: row.version,
    updated_at: row.updatedAt,
  };
}

/**
 * PUT /api/admin/users/{id}/budget
 *
 * enabled=false 或 amount=0 都表示清除 —— 页面会把金额清成 0 提交，
 * 接口那边又用 enabled=false 表达同一个意思，只判一个会漏。
 * 清除时把周期起止一起置空，否则前端会显示一个已经作废的周期。
 */
export async function PUT({ request, params }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const id = parseId(params.id);
  if (!id) return errorJson("用户 id 不合法", 400);

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (!user) return errorJson("用户不存在", 404);

  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  let enabled: boolean | undefined;
  if (body?.enabled !== undefined && body?.enabled !== null) {
    if (typeof body.enabled !== "boolean") return errorJson("enabled 必须是布尔值", 400);
    enabled = body.enabled;
  }

  let amount: number | undefined;
  if (body?.amount !== undefined && body?.amount !== null) {
    // 只认数字，且要在 DECIMAL(14,8) 能表示的范围内，否则 MySQL 会报范围错
    if (typeof body.amount !== "number") return errorJson("预算金额必须是数字", 400);
    const problem = checkMoney(body.amount, "预算金额");
    if (problem) return errorJson(problem, 400);
    amount = body.amount;
    if (amount < 0) {
      return errorJson("预算金额必须是不小于 0 的数字", 400);
    }
  }

  let period: BudgetPeriod | undefined;
  if (body?.period !== undefined) {
    const raw = String(body.period);
    if (!(PERIODS as readonly string[]).includes(raw)) {
      return errorJson("period 只能是 day、week 或 month", 400);
    }
    period = raw as BudgetPeriod;
  }

  const [existing] = await db.select().from(userBudgets).where(eq(userBudgets.userId, id)).limit(1);

  const now = new Date();
  // 没传 amount 时沿用库里的值，这样只改 period 不会把金额清零
  const effectiveAmount = amount ?? (existing ? num(existing.amount) : 0);
  const effectivePeriod = period ?? (existing?.period as BudgetPeriod | undefined) ?? "month";
  const clearing = enabled === false || effectiveAmount === 0;
  const nextVersion = (existing?.version ?? 0) + 1;

  const values = {
    userId: id,
    enabled: clearing ? 0 : 1,
    amount: clearing ? "0" : decimal8(effectiveAmount),
    period: effectivePeriod,
    periodStart: clearing ? null : now,
    periodEnd: clearing ? null : periodEnd(effectivePeriod, now),
    // 清除时已用量归零；只改周期或金额时保留，已用量是网关累计出来的
    used: clearing ? "0" : existing?.used ?? "0",
    version: nextVersion,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await db
    .insert(userBudgets)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        enabled: values.enabled,
        amount: values.amount,
        period: values.period,
        periodStart: values.periodStart,
        periodEnd: values.periodEnd,
        used: values.used,
        version: values.version,
        updatedAt: values.updatedAt,
      },
    });

  return json({ data: budgetShape(id, values) });
}
