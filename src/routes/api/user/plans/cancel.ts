import type { APIEvent } from "@solidjs/start/server";
import { and, desc, eq, gt, lte } from "drizzle-orm";

import { requireUser } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, num } from "~/lib/http";
import { subscriptions, users } from "~/lib/schema";

import { proratedRemainingQuota } from "~/lib/quota";

/**
 * POST /api/user/plans/cancel —— 用户自己取消当前订阅，无请求体。
 *
 * 口径（产品决定）：
 *
 *   取消**不退款**，剩余额度当场作废。
 *   用户端只做「停掉续订/不再可用」，钱的去向由管理员走
 *   POST /api/admin/users/{id}/subscription 退款，免得用户自助套现。
 *
 * 响应里带上折算后的剩余额度（forfeited_quota），前端可以提示
 * 「取消后将损失约 X 元额度」，让用户知道代价。
 *
 * 当前生效订阅 = status='active' 且 period_end 未过期，取 period_end 最晚的那条。
 * 一条都没有就回 404。period_end 已过但仍标 active 的行顺手置成 expired。
 */
export async function POST({ request }: APIEvent) {
  const user = await requireUser(request);
  if (!user) return errorJson("请先登录", 401);

  const now = new Date();

  const [active] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, user.id),
        eq(subscriptions.status, "active"),
        gt(subscriptions.periodEnd, now),
      ),
    )
    .orderBy(desc(subscriptions.periodEnd))
    .limit(1);
  if (!active) return errorJson("没有生效中的订阅", 404);

  const forfeited = proratedRemainingQuota(
    {
      quotaKind: active.quotaKind,
      quotaLimit: num(active.quotaLimit),
      periodStart: active.periodStart,
      periodEnd: active.periodEnd,
    },
    now,
  );

  await db.transaction(async tx => {
    // 已过期却还标着 active 的行是脏数据，先归成 expired，免得被当成「当前订阅」
    await tx
      .update(subscriptions)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          eq(subscriptions.userId, user.id),
          eq(subscriptions.status, "active"),
          lte(subscriptions.periodEnd, now),
        ),
      );

    // 同一用户可能因为续费叠了多行 active，取消时一起收掉：
    // 只改最晚那行的话，更早的 active 行会留下来，下次取消又能成功一次。
    await tx
      .update(subscriptions)
      .set({ status: "cancelled", updatedAt: now })
      .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.status, "active")));

    await tx.update(users).set({ planId: null, updatedAt: now }).where(eq(users.id, user.id));
  });

  return json({
    data: {
      plan_id: active.planId,
      cancelled_at: now,
      forfeited_quota: forfeited,
    },
  });
}
