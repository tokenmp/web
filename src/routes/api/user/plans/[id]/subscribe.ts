import type { APIEvent } from "@solidjs/start/server";
import { and, desc, eq, lte } from "drizzle-orm";

import { requireUser } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, num } from "~/lib/http";
import { applyCreditTx, decimal8, InsufficientBalanceError, round8 } from "~/lib/ledger";
import { plans, subscriptions, users } from "~/lib/schema";

import { refundableAmount } from "~/lib/quota";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseId(raw: string | undefined) {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * POST /api/user/plans/{id}/subscribe
 *
 * 订阅即一次扣款加一条订阅记录。分三种情况：
 *
 *   没有生效订阅        整额扣款，写一行订阅（与以前一致）
 *   换到另一个套餐      新价减去旧订阅的剩余额度折算价，只补差价
 *   同一个套餐再订      续费：整额扣款，新写一行，旧周期照常走完
 *
 * 换档为什么要折算：以前是「再订阅一次就按新套餐价格整额扣款」，
 * 从月付换到更高档会把同一段时间收两遍钱。现在把旧订阅剩下那段时间的额度
 * 折成钱抵掉，只收差额。
 *
 * 差额小于等于 0（降级到更便宜的档）时**不再扣款，也不退现** ——
 * 多出来的部分直接作废。这是产品口径：不然用户可以在周期中段降级套现。
 * 旧订阅的额度类型是 requests（按次）时折算价为 0：次数换不回钱。
 *
 * 折算公式见 src/lib/quota.ts。扣款、写订阅、改 users.plan_id 必须原子，所以放在
 * 一个事务里：先锁用户行串行化同一用户的并发换档，再用 applyCreditTx 扣款
 * （applyCredit 会自己开事务，嵌套会废掉原子性）。
 *
 * 按量付费不扣钱只切 plan_id；price=0 的套餐跳过扣款只写订阅。
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
  let charged = 0;
  let fromPlanId: number | null = null;

  try {
    await db.transaction(async tx => {
      // 先把用户行锁住：同一用户并发的订阅/换档在这里排队，
      // 免得两边都看到同一个旧订阅、各扣各的。applyCreditTx 内部还会再锁一次同一行，
      // 同事务内重复加锁无额外代价。
      await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).limit(1).for("update");

      const [current] = await tx
        .select()
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.status, "active")))
        .orderBy(desc(subscriptions.periodEnd))
        .limit(1);

      // period_end 已过的不算生效中，那只是还没来得及收尾的旧行
      const active =
        current && current.periodEnd && current.periodEnd.getTime() > now.getTime() ? current : null;

      // 只有换到别的套餐才折算抵扣；同一个套餐再订是续费，必须整额收新周期的钱，
      // 否则「立即续费」等于免费延长一个周期。
      const switching = active !== null && active.planId !== plan.id;
      let payable = price;

      if (active && switching) {
        fromPlanId = active.planId;

        // 旧订阅的周期天数优先用 period_start..period_end 的实际区间，
        // 只有 period_start 缺失时才回落到旧套餐的 quota_period_days
        let fallbackPeriodDays = 0;
        if (!active.periodStart) {
          const [oldPlan] = await tx
            .select({ quotaPeriodDays: plans.quotaPeriodDays })
            .from(plans)
            .where(eq(plans.id, active.planId))
            .limit(1);
          fallbackPeriodDays = oldPlan?.quotaPeriodDays ?? 0;
        }

        const oldCredit = refundableAmount(
          {
            quotaKind: active.quotaKind,
            quotaLimit: num(active.quotaLimit),
            periodStart: active.periodStart,
            periodEnd: active.periodEnd,
            fallbackPeriodDays,
          },
          now,
        );
        payable = round8(price - oldCredit);
      }

      // payable <= 0：降级时旧额度折算价高于新价，差额不退现、直接作废（产品口径）
      if (payable > 0) {
        await applyCreditTx(tx, {
          userId: user.id,
          amount: -payable,
          source: "subscription",
          refId: `plan-${plan.id}`,
          reason: plan.name,
        });
        charged = payable;
      }

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

      // 换档：旧的生效订阅作废，标 superseded 而不是 expired —— 它不是自然到期
      if (switching) {
        await tx
          .update(subscriptions)
          .set({ status: "superseded", updatedAt: now })
          .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.status, "active")));
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

      await tx.update(users).set({ planId: plan.id, updatedAt: now }).where(eq(users.id, user.id));
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) return errorJson("余额不足", 402);
    throw err;
  }

  // ok 保持不变，前端已经按它写的；charged 与 from_plan_id 是额外提示，可忽略
  return json({ ok: true, charged, from_plan_id: fromPlanId });
}
