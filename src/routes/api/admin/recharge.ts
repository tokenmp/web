import type { APIEvent } from "@solidjs/start/server";
import { and, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { json, num, parsePaging } from "~/lib/http";
import { rechargeOrders, users } from "~/lib/schema";

/**
 * GET /api/admin/recharge
 *
 * 管理端的充值单列表。
 *
 * 与 /api/admin/adjust-logs 的分工：那边是账本视角（谁的钱变过、变多少），
 * 这边是订单视角（谁下了单、渠道回了没、钱有没有真的进账本）。一笔 payment
 * 失败或还挂着的单子在账本里根本不存在，只有这里看得到，所以运营查「哪一单
 * 没到账、哪一单回调失败」要看这一页。
 *
 * 查询参数：page、size、user_id、status、channel、start、end。
 * 非法值一律忽略而不是报错，跟 adjust-logs 的宽松口径一致 —— 表单默认值多半是
 * 空串，报 400 会让一次普通的「点查询」直接失败。
 */
const STATUSES = ["pending", "paid", "failed", "cancelled", "refunded"] as const;

/** 渠道名与用户端下单时的约束一致：字母、数字、下划线、短横线组成的短标识 */
const CHANNEL_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;

export async function GET({ request }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;

  const url = new URL(request.url);
  const { size, offset } = parsePaging(url);

  const filters: SQL[] = [];

  const rawUserId = url.searchParams.get("user_id");
  if (rawUserId) {
    const userId = Number(rawUserId);
    // 非数字的用户条件直接忽略，和 start/end 一个口径
    if (Number.isInteger(userId) && userId > 0) filters.push(eq(rechargeOrders.userId, userId));
  }

  const status = url.searchParams.get("status");
  if (status && (STATUSES as readonly string[]).includes(status)) {
    filters.push(eq(rechargeOrders.status, status));
  }

  const channel = url.searchParams.get("channel");
  if (channel && CHANNEL_PATTERN.test(channel)) {
    filters.push(eq(rechargeOrders.channel, channel));
  }

  const start = url.searchParams.get("start");
  if (start) {
    const d = new Date(start);
    if (!Number.isNaN(d.getTime())) filters.push(gte(rechargeOrders.createdAt, d));
  }

  const end = url.searchParams.get("end");
  if (end) {
    const d = new Date(end);
    if (!Number.isNaN(d.getTime())) filters.push(lte(rechargeOrders.createdAt, d));
  }

  const where = and(...filters);

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: rechargeOrders.id,
        orderNo: rechargeOrders.orderNo,
        userId: rechargeOrders.userId,
        userName: users.name,
        userEmail: users.email,
        amount: rechargeOrders.amount,
        currency: rechargeOrders.currency,
        channel: rechargeOrders.channel,
        status: rechargeOrders.status,
        externalNo: rechargeOrders.externalNo,
        paidAt: rechargeOrders.paidAt,
        creditTransactionId: rechargeOrders.creditTransactionId,
        createdAt: rechargeOrders.createdAt,
        updatedAt: rechargeOrders.updatedAt,
      })
      .from(rechargeOrders)
      .innerJoin(users, eq(users.id, rechargeOrders.userId))
      .where(where)
      // 同一毫秒下的多单靠自增 id 兜底，翻页才不会漏读或重复
      .orderBy(desc(rechargeOrders.createdAt), desc(rechargeOrders.id))
      .limit(size)
      .offset(offset),
    db
      .select({ n: count() })
      .from(rechargeOrders)
      .innerJoin(users, eq(users.id, rechargeOrders.userId))
      .where(where),
  ]);

  // decimal 列读出来是字符串，金额统一用 num() 转数字再出去
  const items = rows.map(row => ({
    id: row.id,
    order_no: row.orderNo,
    user_id: row.userId,
    user_name: row.userName,
    user_email: row.userEmail,
    amount: num(row.amount),
    currency: row.currency,
    channel: row.channel,
    status: row.status,
    external_no: row.externalNo,
    paid_at: row.paidAt,
    // 为空表示这单还没入账，前端据此打「未入账」标
    credit_transaction_id: row.creditTransactionId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }));

  return json({ items, total: Number(total?.n ?? 0) });
}
