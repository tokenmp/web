import type { APIEvent } from "@solidjs/start/server";
import { and, eq } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { duplicateMessageFor } from "~/lib/db-error";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { decimal8 } from "~/lib/ledger";
import { plans, planPrices } from "~/lib/schema";
import { checkMoney, checkText, PRICE } from "~/lib/validate";
import { planPriceRow } from "../../plans";

const COST_MODES = ["token", "request"] as const;

function parseId(raw: string | undefined) {
  const id = Number(raw);
  // 必须是整数：1.5 以前算合法 id 然后查不到，回了 404；
  // openapi 把非整数归 400，两者要分得开
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * 取一个可选的金额字段。
 *
 * 只认数字：之前用 Number(value) 强转，`"2"`、`"1e2"` 都被收下了，
 * openapi 声明这些字段是 number，传字符串应当回 400。
 */
function optionalDecimal(value: unknown, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  return value;
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

  const modelProblem = checkText(body?.model, "model", 128);
  if (modelProblem) return errorJson(modelProblem, 400);
  const model = (body?.model as string).trim();

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
  if (allAmounts.some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0)) {
    return errorJson("金额字段必须是非负数字", 400);
  }
  // 列是 DECIMAL(18,8)，整数部分 10 位，超了 MySQL 会抛 ER_WARN_DATA_OUT_OF_RANGE
  for (const [label, value] of Object.entries({
    input_per_million: inputPerMillion,
    output_per_million: outputPerMillion,
    cache_read_per_million: cacheReadPerMillion,
    cache_write_per_million: cacheWritePerMillion,
    per_request: perRequest,
    request_weight: requestWeight,
  })) {
    const problem = checkMoney(value, label, PRICE);
    if (problem) return errorJson(problem, 400);
  }
  if ((requestWeight as number) <= 0) return errorJson("request_weight 必须大于 0", 400);

  const [duplicate] = await db
    .select({ id: planPrices.id })
    .from(planPrices)
    .where(and(eq(planPrices.planId, id), eq(planPrices.model, model)))
    .limit(1);
  if (duplicate) return errorJson("该模型已有定价", 409);

  const now = new Date();
  let createdId: number;
  try {
    const [created] = await db
      .insert(planPrices)
      .values({
        planId: id,
        model,
        costMode,
        inputPerMillion: decimal8(inputPerMillion as number),
        outputPerMillion: decimal8(outputPerMillion as number),
        cacheReadPerMillion: decimal8(cacheReadPerMillion as number),
        cacheWritePerMillion: decimal8(cacheWritePerMillion as number),
        perRequest: decimal8(perRequest as number),
        requestWeight: decimal8(requestWeight as number),
        createdAt: now,
        updatedAt: now,
      })
      .$returningId();
    createdId = created.id;
  } catch (err) {
    // 并发下预检查会放过，真正撞上 uk_plan_prices_model 要回 409
    const dup = duplicateMessageFor(err, {}, "该模型已有定价");
    if (dup) return errorJson(dup, 409);
    throw err;
  }

  const [row] = await db.select().from(planPrices).where(eq(planPrices.id, createdId)).limit(1);
  return json({ data: planPriceRow(row) });
}
