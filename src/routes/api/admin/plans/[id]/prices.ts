import type { APIEvent } from "@solidjs/start/server";
import { and, eq } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { decimal8 } from "~/lib/ledger";
import { plans, planPrices } from "~/lib/schema";
import { planPriceRow } from "../../plans";

const COST_MODES = ["token", "request"] as const;

function parseId(raw: string | undefined) {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function optionalDecimal(value: unknown, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * POST /api/admin/plans/{id}/prices
 *
 * 给套餐加一条模型价。同一个套餐下同一个模型只能有一条，重复 409。
 * 金额字段都按数字收，落库前转成 DECIMAL 字符串；未传的按 0，request_weight 未传按 1。
 */
export async function POST({ request, params }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const id = parseId(params.id);
  if (!id) return errorJson("套餐 id 不合法", 400);

  // 已软删的套餐不再加价，否则价格会挂在一个前台看不到的套餐上
  const [plan] = await db
    .select({ id: plans.id, status: plans.status })
    .from(plans)
    .where(eq(plans.id, id))
    .limit(1);
  if (!plan || plan.status !== 1) return errorJson("套餐不存在", 404);

  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  const model = String(body?.model ?? "").trim();
  if (!model) return errorJson("model 不能为空", 400);
  if (model.length > 128) return errorJson("model 不能超过 128 字符", 400);

  const costMode = String(body?.cost_mode ?? "token");
  if (!(COST_MODES as readonly string[]).includes(costMode)) {
    return errorJson("cost_mode 只能是 token 或 request", 400);
  }

  const inputPerMillion = optionalDecimal(body?.input_per_million);
  const outputPerMillion = optionalDecimal(body?.output_per_million);
  const cacheReadPerMillion = optionalDecimal(body?.cache_read_per_million);
  const cacheWritePerMillion = optionalDecimal(body?.cache_write_per_million);
  const perRequest = optionalDecimal(body?.per_request);
  const requestWeight = optionalDecimal(body?.request_weight, 1);
  const allAmounts = [
    inputPerMillion,
    outputPerMillion,
    cacheReadPerMillion,
    cacheWritePerMillion,
    perRequest,
    requestWeight,
  ];
  if (allAmounts.some(n => !Number.isFinite(n) || n < 0)) {
    return errorJson("金额字段必须是非负数字", 400);
  }
  if (requestWeight <= 0) return errorJson("request_weight 必须大于 0", 400);

  const [duplicate] = await db
    .select({ id: planPrices.id })
    .from(planPrices)
    .where(and(eq(planPrices.planId, id), eq(planPrices.model, model)))
    .limit(1);
  if (duplicate) return errorJson("该模型已有定价", 409);

  const now = new Date();
  const [created] = await db
    .insert(planPrices)
    .values({
      planId: id,
      model,
      costMode,
      inputPerMillion: decimal8(inputPerMillion),
      outputPerMillion: decimal8(outputPerMillion),
      cacheReadPerMillion: decimal8(cacheReadPerMillion),
      cacheWritePerMillion: decimal8(cacheWritePerMillion),
      perRequest: decimal8(perRequest),
      requestWeight: decimal8(requestWeight),
      createdAt: now,
      updatedAt: now,
    })
    .$returningId();

  const [row] = await db.select().from(planPrices).where(eq(planPrices.id, created.id)).limit(1);
  return json({ data: planPriceRow(row) });
}
