import type { APIEvent } from "@solidjs/start/server";
import { and, count, countDistinct, eq, gt, gte, lte, sum } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, num } from "~/lib/http";
import { subscriptions } from "~/lib/schema";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/admin/plan-activations/summary
 *
 * 四个数字：
 *   subscribers       当前活跃订阅（未过期）的去重用户数
 *   month_revenue     本自然月内 created_at 的订阅金额之和
 *   week_activations  近 7 天新增的订阅行数
 *   expiring_7d       未来 7 天内到期的活跃订阅数
 *
 * 月的边界按 UTC 算：连接本身按 UTC 解析 datetime，用 UTC 切月才不会在跨时区时错一天。
 */
export async function GET({ request }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * DAY_MS);
  const weekStart = new Date(now.getTime() - 7 * DAY_MS);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [[subscribers], [revenue], [week], [expiring]] = await Promise.all([
    db
      .select({ n: countDistinct(subscriptions.userId) })
      .from(subscriptions)
      .where(and(eq(subscriptions.status, "active"), gt(subscriptions.periodEnd, now))),
    db
      .select({ total: sum(subscriptions.amount) })
      .from(subscriptions)
      .where(gte(subscriptions.createdAt, monthStart)),
    db
      .select({ n: count() })
      .from(subscriptions)
      .where(gte(subscriptions.createdAt, weekStart)),
    db
      .select({ n: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.status, "active"),
          gt(subscriptions.periodEnd, now),
          lte(subscriptions.periodEnd, in7),
        ),
      ),
  ]);

  return json({
    data: {
      subscribers: Number(subscribers?.n ?? 0),
      month_revenue: num(revenue?.total),
      week_activations: Number(week?.n ?? 0),
      expiring_7d: Number(expiring?.n ?? 0),
    },
  });
}
