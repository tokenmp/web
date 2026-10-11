import type { APIEvent } from "@solidjs/start/server";
import { count, desc, eq } from "drizzle-orm";

import { requireUser } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, num, parsePaging } from "~/lib/http";
import { creditAvailable } from "~/lib/ledger";
import { creditTransactions, users } from "~/lib/schema";

/**
 * GET /api/user/credits
 *
 * 我的额度概览与流水。这里是用户的**全部**流水，用量扣费、订阅扣款都要看得到，
 * 与 /admin/adjust-logs 只取两类不同 —— 那是审计视角，这是对账视角。
 *
 * 额度从 users 表现读而不是用会话里的旧值，保证刚调完账就刷新能看到新余额。
 * credit_available 不落库，用 credit_limit - credit_used 现算，口径与账本一致。
 *
 * 注意响应里 total 在 data 内部，这是 openapi 明写的例外；其他列表端点在顶层。
 */
export async function GET({ request }: APIEvent) {
  const user = await requireUser(request);
  if (!user) return errorJson("请先登录", 401);

  const url = new URL(request.url);
  const { size, offset } = parsePaging(url);

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: creditTransactions.id,
        userId: creditTransactions.userId,
        delta: creditTransactions.delta,
        balanceAfter: creditTransactions.balanceAfter,
        source: creditTransactions.source,
        refId: creditTransactions.refId,
        createdAt: creditTransactions.createdAt,
        detail: creditTransactions.detail,
        model: creditTransactions.model,
        totalTokens: creditTransactions.totalTokens,
        balancePart: creditTransactions.balancePart,
        creditPart: creditTransactions.creditPart,
      })
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, user.id))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(size)
      .offset(offset),
    db.select({ n: count() }).from(creditTransactions).where(eq(creditTransactions.userId, user.id)),
  ]);

  return json({
    data: {
      balance: num(user.balance),
      credit_limit: num(user.creditLimit),
      credit_available: creditAvailable(num(user.creditLimit), num(user.creditUsed)),
      total: Number(total?.n ?? 0),
      transactions: rows.map(row => ({
        id: row.id,
        user_id: row.userId,
        delta: num(row.delta),
        balance_after: num(row.balanceAfter),
        source: row.source,
        ref_id: row.refId,
        created_at: row.createdAt,
        detail: row.detail,
        model: row.model,
        total_tokens: row.totalTokens,
        balance_part: num(row.balancePart),
        credit_part: num(row.creditPart),
      })),
    },
  });
}
