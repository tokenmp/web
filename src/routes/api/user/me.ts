import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";

import { requireUser } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, num } from "~/lib/http";
import { creditAvailable, round8 } from "~/lib/ledger";
import { userBudgets } from "~/lib/schema";

/**
 * GET /api/user/me
 *
 * 用户端的当前用户，比 /auth/me 多了额度与预算。
 * 不返回 credit_used：PanelMe 的字段集由 openapi 定死，多给的字段前端不用却容易引起误解，
 * 需要「已用信用」的话用 credit_limit - credit_available 自己算。
 */
export async function GET({ request }: APIEvent) {
  const user = await requireUser(request);
  if (!user) return errorJson("请先登录", 401);

  const [budgetRow] = await db
    .select()
    .from(userBudgets)
    .where(eq(userBudgets.userId, user.id))
    .limit(1);

  // schema 里写了：enabled=0 或 amount=0 都算没设，两个条件都要判，
  // 否则用户把预算开关关掉之后这里还会回一个假的封顶额。
  const budget =
    budgetRow && budgetRow.enabled === 1 && num(budgetRow.amount) !== 0
      ? {
          amount: num(budgetRow.amount),
          period: budgetRow.period,
          used: num(budgetRow.used),
          remaining: round8(num(budgetRow.amount) - num(budgetRow.used)),
        }
      : null;

  const creditLimit = num(user.creditLimit);
  const creditUsed = num(user.creditUsed);

  return json({
    data: {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      role: user.role,
      credit_limit: creditLimit,
      credit_available: creditAvailable(creditLimit, creditUsed),
      plan_id: user.planId,
      balance: num(user.balance),
      created_at: user.createdAt,
      updated_at: user.updatedAt,
      budget,
    },
  });
}
