/**
 * 用户自助充值的服务端逻辑。
 *
 * 本机没有接任何真实支付渠道，所以先按「模拟渠道」把可控的部分做完：
 * 用户下单拿到一个 pending 的单子，渠道（现在是人造回调）回来说这张单付了，
 * 本机再把钱记进账本。真接渠道时只换回调的来源，这里的分支不用动。
 *
 * 幂等的判据只有一条：处理前单子的状态是不是 pending。
 * 是就在同一个事务里入账并把状态推进到 paid；不是就直接返回 already，
 * 绝不重复入账。选择「读当前状态 + FOR UPDATE 行锁」而不是「查 credit_transactions
 * 有没有同 ref_id 的流水」，是因为后者在并发下要先读到空再插入，还得靠唯一键兜底，
 * 而单子状态只有一个写入点，锁住它就够了。
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { count, desc, eq } from "drizzle-orm";

import { isDuplicateEntry } from "./db-error";
import { db } from "./db";
import { num } from "./http";
import { applyCreditTx, decimal8, LedgerError } from "./ledger";
import { rechargeOrders, type RechargeOrderRow } from "./schema";

/** 回调允许推进到的状态。paid 才入账，其余只改单子状态 */
export const CALLBACK_STATUSES = ["paid", "failed", "cancelled", "refunded"] as const;
export type CallbackStatus = (typeof CALLBACK_STATUSES)[number];

/** 默认渠道。没接真渠道之前，下单与回调都走它 */
export const DEFAULT_CHANNEL = "mock";

/**
 * 内部端点（充值回调、记录摄入）共用的共享密钥。
 *
 * 这两个端点不由浏览器调用，走不了会话 cookie —— 重启网关进程时也没有登录态可用。
 * 用环境变量里的一个共享串做机器对机器的认证，够用且不引新依赖。
 *
 * 没配时只在非生产环境放行（本机开发方便），并在模块加载（进程启动）时警告一句；
 * 生产环境缺密钥直接拒绝，避免把「能随便给人加钱」的端点暴露出去。
 */
export function callbackSecret(): string | null {
  const value = process.env.RECHARGE_CALLBACK_SECRET;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

if (!callbackSecret() && process.env.NODE_ENV !== "production") {
  console.warn(
    "[内部端点] RECHARGE_CALLBACK_SECRET 没有配置，" +
      "充值回调与记录摄入只在非生产环境放行。生产环境必须设置它。",
  );
}

/** 定长比较，避免按字符逐位比较泄漏长度与差异位置 */
function secretMatches(got: string, expected: string) {
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 校验内部调用的共享密钥。通过返回 null，不通过返回可以直接 return 的响应。
 *
 * 401 与 403 分开：没带密钥是没认证，带了但不对是认证失败。
 */
export function checkCallbackSecret(
  request: Request,
  makeError: (message: string, status: number) => Response,
): Response | null {
  const expected = callbackSecret();
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return makeError("内部回调密钥未配置，已拒绝调用", 503);
    }
    return null;
  }

  const got = request.headers.get("x-callback-secret");
  if (!got) return makeError("缺少 x-callback-secret 请求头", 401);
  if (!secretMatches(got, expected)) return makeError("x-callback-secret 不正确", 403);
  return null;
}

/** 单号形如 rc-1699999999999-a1b2c3d4，时间戳便于人肉排序，随机段避免同毫秒撞车 */
function generateOrderNo() {
  return `rc-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

/** 充值单的对外形状（snake_case） */
export function serializeOrder(row: RechargeOrderRow) {
  return {
    id: row.id,
    order_no: row.orderNo,
    user_id: row.userId,
    amount: num(row.amount),
    currency: row.currency,
    channel: row.channel,
    status: row.status,
    external_no: row.externalNo,
    paid_at: row.paidAt,
    credit_transaction_id: row.creditTransactionId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/** 下单。单号撞车就重试几次，唯一键是最终防线 */
export async function createRechargeOrder(input: {
  userId: number;
  amount: number;
  channel: string;
  currency?: string;
}) {
  const now = new Date();
  let orderNo = "";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    orderNo = generateOrderNo();
    try {
      await db.insert(rechargeOrders).values({
        orderNo,
        userId: input.userId,
        amount: decimal8(input.amount),
        currency: input.currency ?? "CNY",
        channel: input.channel,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      break;
    } catch (err) {
      if (isDuplicateEntry(err) && attempt < 4) continue;
      throw err;
    }
  }

  const [row] = await db
    .select()
    .from(rechargeOrders)
    .where(eq(rechargeOrders.orderNo, orderNo))
    .limit(1);

  if (!row) throw new Error("充值单写入后读不到，请检查数据库");
  return row;
}

/** 我的充值单，按时间倒序分页 */
export async function listRechargeOrders(input: { userId: number; size: number; offset: number }) {
  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(rechargeOrders)
      .where(eq(rechargeOrders.userId, input.userId))
      .orderBy(desc(rechargeOrders.createdAt), desc(rechargeOrders.id))
      .limit(input.size)
      .offset(input.offset),
    db.select({ n: count() }).from(rechargeOrders).where(eq(rechargeOrders.userId, input.userId)),
  ]);

  return { items: rows.map(serializeOrder), total: Number(totalRow?.n ?? 0) };
}

export type CallbackResult =
  | { kind: "not_found" }
  /** 单子已经不在 pending，重复回调；没有再次入账 */
  | { kind: "already"; order: RechargeOrderRow }
  /** 第一次收到 paid：已入账并推进状态 */
  | { kind: "credited"; order: RechargeOrderRow; transactionId: number }
  /** 第一次收到 failed / cancelled / refunded：只改状态 */
  | { kind: "marked"; order: RechargeOrderRow }
  | { kind: "user_missing"; order: RechargeOrderRow };

/**
 * 处理渠道回调。整个过程在一个事务里：锁住单子那一行 -> 判状态 -> 需要就入账并改单。
 * 并发两次 paid 回调里，第二个会阻塞在行锁上，等第一个提交后读到 paid，走 already。
 */
export async function processRechargeCallback(input: {
  orderNo: string;
  externalNo: string | null;
  status: CallbackStatus;
}): Promise<CallbackResult> {
  return db.transaction(async tx => {
    const [order] = await tx
      .select()
      .from(rechargeOrders)
      .where(eq(rechargeOrders.orderNo, input.orderNo))
      .limit(1)
      .for("update");

    if (!order) return { kind: "not_found" as const };

    if (order.status !== "pending") {
      return { kind: "already" as const, order };
    }

    const now = new Date();
    const externalNo = input.externalNo ?? order.externalNo;

    if (input.status !== "paid") {
      await tx
        .update(rechargeOrders)
        .set({ status: input.status, externalNo, updatedAt: now })
        .where(eq(rechargeOrders.id, order.id));

      return { kind: "marked" as const, order: { ...order, status: input.status, externalNo, updatedAt: now } };
    }

    let transactionId: number;
    try {
      const result = await applyCreditTx(tx, {
        userId: order.userId,
        amount: num(order.amount),
        source: "recharge",
        refId: order.orderNo,
        reason: "充值",
      });
      transactionId = result.transactionId;
    } catch (err) {
      if (err instanceof LedgerError && err.code === "user_not_found") {
        return { kind: "user_missing" as const, order };
      }
      throw err;
    }

    await tx
      .update(rechargeOrders)
      .set({
        status: "paid",
        paidAt: now,
        externalNo,
        creditTransactionId: transactionId,
        updatedAt: now,
      })
      .where(eq(rechargeOrders.id, order.id));

    return {
      kind: "credited" as const,
      order: {
        ...order,
        status: "paid",
        paidAt: now,
        externalNo,
        creditTransactionId: transactionId,
        updatedAt: now,
      },
      transactionId,
    };
  });
}
