import type { APIEvent } from "@solidjs/start/server";
import { asc, eq, ne, and } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { plans, planPrices } from "~/lib/schema";
import { parsePlanInput, planCore, planPriceRow } from "../plans";

function parseId(raw: string | undefined) {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** GET /api/admin/plans/{id} — 套餐本体与它名下全部模型价 */
export async function GET({ request, params }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const id = parseId(params.id);
  if (!id) return errorJson("套餐 id 不合法", 400);

  const [row] = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  if (!row) return errorJson("套餐不存在", 404);

  const prices = await db
    .select()
    .from(planPrices)
    .where(eq(planPrices.planId, id))
    .orderBy(asc(planPrices.id));

  return json({ data: { plan: planCore(row), prices: prices.map(planPriceRow) } });
}

/**
 * PUT /api/admin/plans/{id}
 *
 * 整体替换，不是局部更新：请求体与新建相同，没传的字段会被写成默认值
 * （quota_amount=0、quota_period_days=0、markup_multiplier=1 之类）。
 * 只改一两个字段请用 GET 拿全量再改，别把没填的字段当成「保持原样」。
 */
export async function PUT({ request, params }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const id = parseId(params.id);
  if (!id) return errorJson("套餐 id 不合法", 400);

  const [existing] = await db.select({ id: plans.id }).from(plans).where(eq(plans.id, id)).limit(1);
  if (!existing) return errorJson("套餐不存在", 404);

  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  const parsed = parsePlanInput(body ?? {});
  if (!parsed.ok) return errorJson(parsed.message, 400);

  const [duplicate] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.name, parsed.value.name), ne(plans.id, id)))
    .limit(1);
  if (duplicate) return errorJson("套餐名已存在", 409);

  await db
    .update(plans)
    .set({ ...parsed.value, updatedAt: new Date() })
    .where(eq(plans.id, id));

  return json({ ok: true });
}

/**
 * DELETE /api/admin/plans/{id}
 *
 * 软删套餐（status=0），同时物理删掉它名下的 plan_prices ——
 * 模型价只对当前套餐有意义，留着会跟着软删套餐一起被详情接口回显出来。
 */
export async function DELETE({ request, params }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const id = parseId(params.id);
  if (!id) return errorJson("套餐 id 不合法", 400);

  const [row] = await db.select({ id: plans.id }).from(plans).where(eq(plans.id, id)).limit(1);
  if (!row) return errorJson("套餐不存在", 404);

  const now = new Date();
  await db.transaction(async tx => {
    await tx.delete(planPrices).where(eq(planPrices.planId, id));
    await tx.update(plans).set({ status: 0, updatedAt: now }).where(eq(plans.id, id));
  });

  return json({ ok: true });
}
