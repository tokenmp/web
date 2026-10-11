import type { APIEvent } from "@solidjs/start/server";
import { and, count, desc, eq, inArray } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, num, parsePaging } from "~/lib/http";
import { creditTransactions, plans } from "~/lib/schema";

function parseId(raw: string | undefined) {
  const id = Number(raw);
  // 必须是整数：1.5 以前算合法 id 然后查不到，回了 404；
  // openapi 把非整数归 400，两者要分得开
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** ref_id 形如 plan-3，取中间的套餐 id；解析不出返回 null */
function planIdFromRef(refId: string | null) {
  if (!refId) return null;
  const match = /^plan-(\d+)$/.exec(refId);
  return match ? Number(match[1]) : null;
}

/**
 * GET /api/admin/plan-activations/{user_id}/history
 *
 * 某用户的订阅激活流水，数据源是 credit_transactions 里 source='subscription' 的行。
 *
 * 订阅是扣款，账本里 delta 是负数；这里把 amount 翻成正数返回，
 * 因为前端要显示的是「这次订阅花了多少」，负数容易读成退款。
 * plan_name 从 ref_id 解析出套餐 id 再查 plans；套餐已软删（status=0）解析不出则给空串。
 */
export async function GET({ request, params }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const userId = parseId(params.user_id);
  if (!userId) return errorJson("用户 id 不合法", 400);

  const url = new URL(request.url);
  const { size, offset } = parsePaging(url);
  const where = and(
    eq(creditTransactions.userId, userId),
    eq(creditTransactions.source, "subscription"),
  );

  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(creditTransactions)
      .where(where)
      .orderBy(desc(creditTransactions.createdAt), desc(creditTransactions.id))
      .limit(size)
      .offset(offset),
    db.select({ n: count() }).from(creditTransactions).where(where),
  ]);

  const planIds = [...new Set(rows.map(row => planIdFromRef(row.refId)).filter((id): id is number => id !== null))];
  const planRows = planIds.length
    ? await db
        .select({ id: plans.id, name: plans.name, status: plans.status })
        .from(plans)
        .where(inArray(plans.id, planIds))
    : [];
  const nameById = new Map(planRows.map(row => [row.id, row.status === 1 ? row.name : ""]));

  const items = rows.map(row => {
    const planId = planIdFromRef(row.refId);
    return {
      created_at: row.createdAt,
      amount: -num(row.delta),
      ref_id: row.refId ?? "",
      plan_name: planId !== null ? (nameById.get(planId) ?? "") : "",
      balance_after: num(row.balanceAfter),
    };
  });

  return json({ items, total: Number(total?.n ?? 0) });
}
