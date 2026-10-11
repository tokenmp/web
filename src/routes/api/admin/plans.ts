import type { APIEvent } from "@solidjs/start/server";
import { and, asc, eq, gt, sql } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { duplicateMessageFor } from "~/lib/db-error";
import { db } from "~/lib/db";
import { errorJson, json, num } from "~/lib/http";
import { decimal8 } from "~/lib/ledger";
import { plans, subscriptions, type PlanPriceRow, type PlanRow } from "~/lib/schema";
import { checkInt32, checkMoney, checkText, PRICE } from "~/lib/validate";

const MODES = ["pay_as_you_go", "subscription"] as const;
const PRICING_MODES = ["markup", "table"] as const;
const QUOTA_KINDS = ["money", "requests"] as const;
const OVERAGE_MODES = ["disabled", "bill"] as const;

/**
 * PlanCore 序列化。
 *
 * features / recommended / sort_order 是本地扩展的三个字段，openapi 的 PlanCore 里没有，
 * 但销售页要按卖点与推荐标渲染，所以一起返回。decimal 列回来是字符串，用 num 转成数字。
 */
export function planCore(row: PlanRow) {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    pricing_mode: row.pricingMode,
    markup_multiplier: num(row.markupMultiplier),
    rate_rules: Array.isArray(row.rateRules) ? row.rateRules : [],
    quota_kind: row.quotaKind,
    quota_amount: num(row.quotaAmount),
    quota_period_days: row.quotaPeriodDays,
    overage_mode: row.overageMode,
    price: num(row.price),
    currency: row.currency,
    status: row.status,
    features: Array.isArray(row.features) ? row.features : [],
    recommended: row.recommended,
    sort_order: row.sortOrder,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/** PlanPrice 序列化，同样把 decimal 列转成数字 */
export function planPriceRow(row: PlanPriceRow) {
  return {
    id: row.id,
    plan_id: row.planId,
    model: row.model,
    cost_mode: row.costMode,
    input_per_million: num(row.inputPerMillion),
    output_per_million: num(row.outputPerMillion),
    cache_read_per_million: num(row.cacheReadPerMillion),
    cache_write_per_million: num(row.cacheWritePerMillion),
    per_request: num(row.perRequest),
    request_weight: num(row.requestWeight),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/** 落到列上的值，decimal 统一写成字符串，免得驱动自己格式化 */
export type PlanValues = {
  name: string;
  mode: string;
  pricingMode: string;
  markupMultiplier: string;
  rateRules: unknown;
  quotaKind: string;
  quotaAmount: string;
  quotaPeriodDays: number;
  overageMode: string;
  price: string;
  currency: string;
  features: string[] | null;
  recommended: number;
  sortOrder: number;
};

export type PlanInputResult =
  | { ok: true; value: PlanValues }
  | { ok: false; message: string };

function oneOf(value: string, allowed: readonly string[]) {
  return allowed.includes(value);
}

/**
 * 解析新建 / 整体替换套餐的请求体。
 *
 * 抽出来给 plans.ts 的 POST 与 [id].ts 的 PUT 共用，两处的字段口径必须一致，
 * 否则「整体替换」会把某一处漏掉的字段写成默认值。
 */
export function parsePlanInput(body: Record<string, unknown>): PlanInputResult {
  // 只认字符串。之前用 String(body.name ?? "") 强转，传 {} 会建出一个叫 [object Object] 的套餐
  const nameProblem = checkText(body.name, "套餐名", 64);
  if (nameProblem) return { ok: false, message: nameProblem };
  const name = (body.name as string).trim();

  const mode = String(body.mode ?? "");
  if (!oneOf(mode, MODES)) return { ok: false, message: "mode 只能是 pay_as_you_go 或 subscription" };

  const pricingMode = String(body.pricing_mode ?? "");
  if (!oneOf(pricingMode, PRICING_MODES)) {
    return { ok: false, message: "pricing_mode 只能是 markup 或 table" };
  }

  const quotaKind = String(body.quota_kind ?? "money");
  if (!oneOf(quotaKind, QUOTA_KINDS)) {
    return { ok: false, message: "quota_kind 只能是 money 或 requests" };
  }

  const overageMode = String(body.overage_mode ?? "disabled");
  if (!oneOf(overageMode, OVERAGE_MODES)) {
    return { ok: false, message: "overage_mode 只能是 disabled 或 bill" };
  }

  const rawMultiplier = body.markup_multiplier;
  const markupMultiplier =
    rawMultiplier === undefined || rawMultiplier === null || rawMultiplier === "" ? 1 : rawMultiplier;
  if (typeof markupMultiplier !== "number" || !Number.isFinite(markupMultiplier) || markupMultiplier <= 0) {
    return { ok: false, message: "markup_multiplier 必须是大于 0 的数字" };
  }
  const multiplierProblem = checkMoney(markupMultiplier, "markup_multiplier");
  if (multiplierProblem) return { ok: false, message: multiplierProblem };

  const rawPrice = body.price;
  const price = rawPrice === undefined || rawPrice === null || rawPrice === "" ? 0 : rawPrice;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
    return { ok: false, message: "price 必须是非负数字" };
  }
  // 超出 DECIMAL 能表示的范围时 MySQL 会抛 ER_WARN_DATA_OUT_OF_RANGE，
  // 不挡在入库前就变成 500
  const priceProblem = checkMoney(price, "price");
  if (priceProblem) return { ok: false, message: priceProblem };

  const rawAmount = body.quota_amount;
  const hasAmount = rawAmount !== undefined && rawAmount !== null && rawAmount !== "";
  const quotaAmount = hasAmount ? rawAmount : 0;
  if (typeof quotaAmount !== "number" || !Number.isFinite(quotaAmount) || quotaAmount < 0) {
    return { ok: false, message: "quota_amount 必须是非负数字" };
  }
  const amountProblem = checkMoney(quotaAmount, "quota_amount", PRICE);
  if (amountProblem) return { ok: false, message: amountProblem };

  const rawDays = body.quota_period_days;
  const hasDays = rawDays !== undefined && rawDays !== null && rawDays !== "";
  const quotaPeriodDays = hasDays ? rawDays : 0;
  if (typeof quotaPeriodDays !== "number" || !Number.isFinite(quotaPeriodDays) || quotaPeriodDays < 0) {
    return { ok: false, message: "quota_period_days 必须是非负数字" };
  }
  const daysProblem = checkInt32(quotaPeriodDays, "quota_period_days");
  if (daysProblem) return { ok: false, message: daysProblem };

  // 订阅制没有额度与周期就没有可执行的含义，openapi 也把这两个列成订阅时的必填
  if (mode === "subscription" && (!hasAmount || quotaAmount <= 0)) {
    return { ok: false, message: "订阅套餐必须填 quota_amount 且大于 0" };
  }
  if (mode === "subscription" && (!hasDays || quotaPeriodDays <= 0)) {
    return { ok: false, message: "订阅套餐必须填 quota_period_days 且大于 0" };
  }

  const rawCurrency = body.currency;
  const currency = rawCurrency === undefined || rawCurrency === null ? "CNY" : rawCurrency;
  if (typeof currency !== "string" || currency.length !== 3) {
    return { ok: false, message: "currency 必须是 3 个字符的字符串" };
  }

  let features: string[] | null = null;
  if (body.features !== undefined && body.features !== null) {
    if (!Array.isArray(body.features)) return { ok: false, message: "features 必须是字符串数组" };
    features = body.features.map(item => String(item));
  }

  const rateRules = body.rate_rules === undefined ? null : body.rate_rules;

  // sort_order 是 int32，塞 1e15 会撞上 MySQL 的范围报错变成 500
  const rawSortOrder = body.sort_order;
  const sortOrderValue =
    rawSortOrder === undefined || rawSortOrder === null || rawSortOrder === "" ? 0 : rawSortOrder;
  const sortProblem = checkInt32(sortOrderValue, "sort_order");
  if (sortProblem) return { ok: false, message: sortProblem };
  const sortOrder = sortOrderValue as number;

  return {
    ok: true,
    value: {
      name,
      mode,
      pricingMode,
      markupMultiplier: decimal8(markupMultiplier),
      rateRules,
      quotaKind,
      quotaAmount: decimal8(quotaAmount),
      quotaPeriodDays,
      overageMode,
      price: decimal8(price),
      currency,
      features,
      recommended: body.recommended ? 1 : 0,
      sortOrder,
    },
  };
}

/**
 * GET /api/admin/plans
 *
 * 默认只回 status=1 的套餐，按 sort_order、id 升序。
 * 管理端要能看到已软删的，传 `status=all`（`all=1` 是等价别名）就一起回。
 * 每个套餐带一个 subscribers：当前活跃订阅（status=active 且未过期）的去重用户数。
 */
export async function GET({ request }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const url = new URL(request.url);
  const includeDeleted =
    url.searchParams.get("status") === "all" || url.searchParams.get("all") === "1";

  const rows = await db
    .select()
    .from(plans)
    .where(includeDeleted ? undefined : eq(plans.status, 1))
    .orderBy(asc(plans.sortOrder), asc(plans.id));

  const now = new Date();
  const subRows = await db
    .select({
      planId: subscriptions.planId,
      subscribers: sql<number>`count(distinct ${subscriptions.userId})`,
    })
    .from(subscriptions)
    .where(and(eq(subscriptions.status, "active"), gt(subscriptions.periodEnd, now)))
    .groupBy(subscriptions.planId);

  const subscriberByPlan = new Map(subRows.map(r => [r.planId, Number(r.subscribers)]));

  const items = rows.map(row => ({
    ...planCore(row),
    subscribers: subscriberByPlan.get(row.id) ?? 0,
  }));

  return json({ items, total: items.length });
}

/**
 * POST /api/admin/plans
 *
 * 新建套餐。name 上挂了唯一索引且唯一约束不认软删，重名一律 409，包括已删套餐占用的名字。
 */
export async function POST({ request }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  const parsed = parsePlanInput(body ?? {});
  if (!parsed.ok) return errorJson(parsed.message, 400);
  const value = parsed.value;

  const [duplicate] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.name, value.name))
    .limit(1);
  if (duplicate) return errorJson("套餐名已存在", 409);

  const now = new Date();
  let createdId: number;
  try {
    const [created] = await db
      .insert(plans)
      .values({ ...value, status: 1, createdAt: now, updatedAt: now })
      .$returningId();
    createdId = created.id;
  } catch (err) {
    // 预检查放过去了之后才撞上唯一键（并发下常见），要翻成 409 而不是 500
    const dup = duplicateMessageFor(err, {}, "套餐名已存在");
    if (dup) return errorJson(dup, 409);
    throw err;
  }

  const [row] = await db.select().from(plans).where(eq(plans.id, createdId)).limit(1);
  return json({ data: planCore(row) });
}
