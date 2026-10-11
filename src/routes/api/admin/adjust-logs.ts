import type { APIEvent } from "@solidjs/start/server";
import { and, count, desc, eq, gte, like, lte, sql } from "drizzle-orm";

import { requireUser } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { num, errorJson, json, parsePaging } from "~/lib/http";
import { creditTransactions, users } from "~/lib/schema";

/**
 * 只取这两类：手工调账与代充。
 * 用量扣费（usage）、订阅扣款（subscription）、分享返额（channel_share）不是「调账」，
 * 混进来会让这个页面既不是账目审计也不是用户流水。用户要看全部流水走 /user/credits。
 */
const ADJUST_SOURCES = ["adjust", "recharge"] as const;

/** 模糊匹配的转义，避免用户输入的 % 与 _ 被当成通配符 */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, ch => `\\${ch}`);
}

/**
 * GET /api/admin/adjust-logs
 *
 * 调账记录，按 created_at 倒序。
 * 查询参数：page、size、user_id、operator（模糊）、direction（credit/debit）、ref（模糊）、start、end。
 * start/end 非法时静默忽略，这是 openapi 明写的：时间过滤只在对得上时才生效，
 * 报 400 反而会让带默认空值的表单提交失败。
 */
export async function GET({ request }: APIEvent) {
  const user = await requireUser(request);
  if (!user) return errorJson("请先登录", 401);
  if (user.role !== "admin") return errorJson("需要管理员权限", 403);

  const url = new URL(request.url);
  const { size, offset } = parsePaging(url);

  const filters = [sql`${creditTransactions.source} in ('adjust', 'recharge')`];

  const rawUserId = url.searchParams.get("user_id");
  if (rawUserId) {
    const userId = Number(rawUserId);
    // 非数字的用户名条件直接忽略，保持与 start/end 相同的宽松口径
    if (Number.isInteger(userId) && userId > 0) filters.push(eq(creditTransactions.userId, userId));
  }

  const operator = url.searchParams.get("operator");
  if (operator) filters.push(like(creditTransactions.operator, `%${escapeLike(operator)}%`));

  const ref = url.searchParams.get("ref");
  if (ref) filters.push(like(creditTransactions.refId, `%${escapeLike(ref)}%`));

  const direction = url.searchParams.get("direction");
  if (direction === "credit") filters.push(sql`${creditTransactions.delta} > 0`);
  else if (direction === "debit") filters.push(sql`${creditTransactions.delta} < 0`);

  const start = url.searchParams.get("start");
  if (start) {
    const d = new Date(start);
    if (!Number.isNaN(d.getTime())) filters.push(gte(creditTransactions.createdAt, d));
  }

  const end = url.searchParams.get("end");
  if (end) {
    const d = new Date(end);
    if (!Number.isNaN(d.getTime())) filters.push(lte(creditTransactions.createdAt, d));
  }

  const where = and(...filters);

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: creditTransactions.id,
        userId: creditTransactions.userId,
        userName: users.name,
        delta: creditTransactions.delta,
        balanceAfter: creditTransactions.balanceAfter,
        refId: creditTransactions.refId,
        reason: creditTransactions.reason,
        operator: creditTransactions.operator,
        createdAt: creditTransactions.createdAt,
      })
      .from(creditTransactions)
      .innerJoin(users, eq(users.id, creditTransactions.userId))
      .where(where)
      .orderBy(desc(creditTransactions.createdAt))
      .limit(size)
      .offset(offset),
    db
      .select({ n: count() })
      .from(creditTransactions)
      .innerJoin(users, eq(users.id, creditTransactions.userId))
      .where(where),
  ]);

  // decimal 列读出来是字符串，金额统一用 num() 转成数字再出去
  const items = rows.map(row => ({
    id: row.id,
    user_id: row.userId,
    user_name: row.userName,
    delta: num(row.delta),
    balance_after: num(row.balanceAfter),
    ref_id: row.refId,
    reason: row.reason,
    operator: row.operator,
    created_at: row.createdAt,
  }));

  return json({ items, total: Number(total?.n ?? 0) });
}
