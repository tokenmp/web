import type { APIEvent } from "@solidjs/start/server";
import { and, desc, eq, gt, lte } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, num } from "~/lib/http";
import { applyCreditTx, type LedgerSource } from "~/lib/ledger";
import { subscriptions, users } from "~/lib/schema";

import { proratedRemainingQuota, refundableAmount } from "~/lib/quota";

/**
 * ledger.ts 的 LedgerSource 还没收录 refund（credit_transactions.source 是 varchar，
 * 落库没问题）。先在这里断言，等基础层补上 `| "refund"` 后可以把断言去掉。
 */
const REFUND_SOURCE: LedgerSource = "refund";

function parseId(raw: string | undefined) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * POST /api/admin/users/{id}/subscription —— 管理员给用户退订，可选退款。
 *
 * body：{ refund?: boolean, reason?: string }，整个 body 可省略。
 *
 * 与用户自助取消 /user/plans/cancel 的区别只有一个：refund=true 时按剩余额度退款。
 * 取消动作本身一致：生效订阅置 cancelled、users.plan_id 置 null，剩余额度作废。
 *
 * 退款口径：
 *   退款额 = 剩余额度按剩余天数折算（见 src/lib/quota.ts 的 refundableAmount）
 *   quota_kind='requests' 的额度是次数不是钱，退不回现金，一律按 0 处理
 *   算出 0 或负数就不记账，也不回落余额
 *   记一笔 source='refund' 的流水，ref_id 指回原订阅，方便对账
 *
 * 取消与退款必须原子：两个写操作都落在一个事务里，退款走 applyCreditTx
 * （applyCredit 会自己开事务，mysql 不支持真嵌套）。
 */
export async function POST({ request, params }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const userId = parseId(params.id);
  if (!userId) return errorJson("用户 id 不合法", 400);

  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return errorJson("用户不存在", 404);

  // body 可省略，也可以传空对象；传了非 JSON 才报 400
  let body: Record<string, unknown> = {};
  const raw = await request.text();
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return errorJson("请求体必须是 JSON 对象", 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return errorJson("请求体不是合法 JSON", 400);
    }
  }

  if (body.refund !== undefined && typeof body.refund !== "boolean") {
    return errorJson("refund 必须是布尔值", 400);
  }
  const wantRefund = body.refund === true;

  let reason: string | null = null;
  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== "string") return errorJson("reason 必须是字符串", 400);
    const trimmed = body.reason.trim();
    if (trimmed.length > 256) return errorJson("reason 不能超过 256 字", 400);
    reason = trimmed || null;
  }

  const now = new Date();

  const [active] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.status, "active"),
        gt(subscriptions.periodEnd, now),
      ),
    )
    .orderBy(desc(subscriptions.periodEnd))
    .limit(1);
  if (!active) return errorJson("没有生效中的订阅", 404);

  const window = {
    quotaKind: active.quotaKind,
    quotaLimit: num(active.quotaLimit),
    periodStart: active.periodStart,
    periodEnd: active.periodEnd,
  };
  const forfeited = proratedRemainingQuota(window, now);
  const refundable = wantRefund ? refundableAmount(window, now) : 0;

  let refunded = 0;
  await db.transaction(async tx => {
    // 先把用户行锁住，退款与余额改动串行化
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1).for("update");

    // 过期的活跃行先归 expired，再把剩下的 active 全部取消
    await tx
      .update(subscriptions)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, "active"),
          lte(subscriptions.periodEnd, now),
        ),
      );
    await tx
      .update(subscriptions)
      .set({ status: "cancelled", updatedAt: now })
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")));

    await tx.update(users).set({ planId: null, updatedAt: now }).where(eq(users.id, userId));

    // 退款额为 0 或负数不记账
    if (refundable > 0) {
      await applyCreditTx(tx, {
        userId,
        amount: refundable,
        source: REFUND_SOURCE,
        refId: `refund-${active.id}`,
        reason,
        operator: admin.name,
      });
      refunded = refundable;
    }
  });

  return json({
    data: {
      plan_id: active.planId,
      cancelled_at: now,
      forfeited_quota: forfeited,
      refunded,
    },
  });
}
