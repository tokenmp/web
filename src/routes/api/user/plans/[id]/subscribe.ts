import type { APIEvent } from "@solidjs/start/server";
import { and, eq, lte } from "drizzle-orm";

import { requireUser } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, num } from "~/lib/http";
import { applyCreditTx, decimal8, InsufficientBalanceError } from "~/lib/ledger";
import { plans, subscriptions, users } from "~/lib/schema";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseId(raw: string | undefined) {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * POST /api/user/plans/{id}/subscribe
 *
 * 订阅即一次扣款加一条订阅记录，续费就是再点一次：每次都新写一行，
 * 老的那行留着当历史，period_end 已过的活跃订阅顺手置成 expired。
 *
 * 扣款、写订阅、改 users.plan_id 必须原子，所以放在一个事务里，
 * 扣款走 applyCreditTx 把事务传进去 —— applyCredit 会自己开事务，嵌套会废掉原子性。
 *
 * 按量付费不扣钱只切 plan_id；price=0 的套餐（比如按次包）跳过扣款只写订阅。
 * 余额与剩余信用都不够时 applyCreditTx 抛 InsufficientBalanceError，翻成 402。
 */
export async function POST({ request, params }: APIEvent) {
  const user = await requireUser(request);
  if (!user) return errorJson("请先登录", 401);

  const id = parseId(params.id);
  if (!id) return errorJson("套餐 id 不合法", 400);

  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, id), eq(plans.status, 1)))
    .limit(1);
  if (!plan) return errorJson("套餐不存在", 404);

  const now = new Date();

  // 按量付费只是换个默认档位，没有额度也没有扣款
  if (plan.mode === "pay_as_you_go") {
    await db
      .update(users)
      .set({ planId: plan.id, updatedAt: now })
      .where(eq(users.id, user.id));
    return json({ ok: true });
  }

  const price = num(plan.price);

  try {
    await db.transaction(async tx => {
      if (price > 0) {
        await applyCreditTx(tx, {
          userId: user.id,
          amount: -price,
          source: "subscription",
          refId: `plan-${plan.id}`,
          reason: plan.name,
        });
      }

      const periodEnd = new Date(now.getTime() + plan.quotaPeriodDays * DAY_MS);
      await tx.insert(subscriptions).values({
        userId: user.id,
        planId: plan.id,
        amount: decimal8(price),
        quotaKind: plan.quotaKind,
        quotaLimit: plan.quotaAmount,
        quotaUsed: "0",
        periodStart: now,
        periodEnd,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });

      // 过期的活跃订阅收尾，免得当前订阅的取值被旧行搅乱
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

      await tx.update(users).set({ planId: plan.id, updatedAt: now }).where(eq(users.id, user.id));
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) return errorJson("余额不足", 402);
    throw err;
  }

  return json({ ok: true });
}
