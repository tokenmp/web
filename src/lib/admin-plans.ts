/**
 * 控制台套餐页的客户端数据层。
 *
 * 覆盖三组接口：套餐与模型价（/api/admin/plans*）、订阅概览与激活列表
 * （/api/admin/plan-activations*）、用户续费历史。字段名与 openapi.yaml 一致，
 * 全是 snake_case，因为后端直接回的就是这个形状。
 *
 * 表单的取值与校验也放这里，页面只做渲染：几个数字字段（金额、倍率、天数、排序）
 * 后端只认 JSON number，传字符串会 400；把「字符串输入 -> 数字/错误文案」的换算
 * 收在一处，页面就不必到处写 Number() 再判 NaN。
 *
 * 注意 PUT /api/admin/plans/{id} 是整体替换：buildPlanInput 产出的对象带齐全部字段，
 * 少一个后端就会写成列默认值（quota_amount=0、markup_multiplier=1 之类）。
 */

import { deleteOk, getData, getList, postData, postOk, putOk, query } from "./api-client";
import { fitsDecimal, fitsInt32, MONEY, PRICE } from "./validate";

/* ------------------------------------------------------------------ 枚举 */

export type PlanMode = "pay_as_you_go" | "subscription";
export type PricingMode = "markup" | "table";
export type QuotaKind = "money" | "requests";
export type OverageMode = "disabled" | "bill";
export type PlanCostMode = "token" | "request";

export const MODE_OPTIONS: { value: PlanMode; label: string }[] = [
  { value: "pay_as_you_go", label: "按量付费" },
  { value: "subscription", label: "订阅制" },
];

export const PRICING_MODE_OPTIONS: { value: PricingMode; label: string }[] = [
  { value: "markup", label: "成本倍率" },
  { value: "table", label: "逐模型定价" },
];

export const QUOTA_KIND_OPTIONS: { value: QuotaKind; label: string }[] = [
  { value: "money", label: "金额额度" },
  { value: "requests", label: "次数额度" },
];

export const OVERAGE_MODE_OPTIONS: { value: OverageMode; label: string }[] = [
  { value: "disabled", label: "超额停用" },
  { value: "bill", label: "超额继续计费" },
];

export const COST_MODE_OPTIONS: { value: PlanCostMode; label: string }[] = [
  { value: "token", label: "按 Token 计费" },
  { value: "request", label: "按次计费" },
];

export const PLAN_MODE_LABELS: Record<string, string> = {
  pay_as_you_go: "按量付费",
  subscription: "订阅制",
};

export const PRICING_MODE_LABELS: Record<string, string> = {
  markup: "成本倍率",
  table: "逐模型定价",
};

export const QUOTA_KIND_LABELS: Record<string, string> = {
  money: "金额",
  requests: "次数",
};

export const OVERAGE_MODE_LABELS: Record<string, string> = {
  disabled: "超额停用",
  bill: "超额计费",
};

export const COST_MODE_LABELS: Record<string, string> = {
  token: "按 Token",
  request: "按次",
};

/* ------------------------------------------------------------------ 类型 */

/** 列表项比详情多一个现算的 subscribers；详情接口不带 */
export type Plan = {
  id: number;
  name: string;
  mode: string;
  pricing_mode: string;
  markup_multiplier: number;
  rate_rules: unknown;
  quota_kind: string;
  quota_amount: number;
  quota_period_days: number;
  overage_mode: string;
  price: number;
  currency: string;
  /** 1 在售，0 已软删 */
  status: number;
  features: string[];
  /** 0/1 */
  recommended: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  subscribers?: number;
};

export type PlanPrice = {
  id: number;
  plan_id: number;
  model: string;
  cost_mode: string;
  input_per_million: number;
  output_per_million: number;
  cache_read_per_million: number;
  cache_write_per_million: number;
  per_request: number;
  request_weight: number;
  created_at: string;
  updated_at: string;
};

export type PlanDetail = { plan: Plan; prices: PlanPrice[] };

/** 新建与整体替换共用的请求体 */
export type PlanInput = {
  name: string;
  mode: PlanMode;
  pricing_mode: PricingMode;
  markup_multiplier: number;
  quota_kind: QuotaKind;
  quota_amount: number;
  quota_period_days: number;
  overage_mode: OverageMode;
  price: number;
  currency: string;
  features: string[];
  recommended: boolean;
  sort_order: number;
  /** 本机扩展字段，表单没有编辑器，编辑时原样带回，免得整体替换把它清成 null */
  rate_rules?: unknown;
};

export type PlanPriceInput = {
  model: string;
  cost_mode: PlanCostMode;
  input_per_million: number;
  output_per_million: number;
  cache_read_per_million: number;
  cache_write_per_million: number;
  per_request: number;
  request_weight: number;
};

export type PlanActivationSummary = {
  subscribers: number;
  month_revenue: number;
  week_activations: number;
  expiring_7d: number;
};

/** 按用户聚合的一条激活记录 */
export type PlanActivation = {
  user_id: number;
  user_name: string;
  plan_id: number;
  plan_name: string;
  plan_mode: string;
  quota_kind: string;
  quota_limit: number;
  quota_used: number;
  period_start: string | null;
  period_end: string | null;
  total_spend: number;
  activation_count: number;
  first_at: string | null;
};

export type PlanActivationHistoryItem = {
  created_at: string;
  amount: number;
  ref_id: string;
  plan_name: string;
  balance_after: number;
};

/* -------------------------------------------------------------- 读接口 */

/** 列表。默认只回在售套餐，includeDeleted 打开后连 status=0 的一起回 */
export function fetchPlans(includeDeleted = false) {
  return getList<Plan>(`/api/admin/plans${query({ status: includeDeleted ? "all" : null })}`);
}

/** 详情：套餐本体与它名下全部模型价 */
export function fetchPlanDetail(id: number) {
  return getData<PlanDetail>(`/api/admin/plans/${id}`);
}

/** 订阅概览的四个数字 */
export function fetchPlanActivationSummary() {
  return getData<PlanActivationSummary>("/api/admin/plan-activations/summary");
}

export type ActivationExpire = "" | "7d" | "expired";

export type ActivationQuery = {
  page: number;
  size: number;
  userId?: number;
  planId?: number;
  /** 只有 7d 与 expired 生效，其余值后端静默忽略 */
  expire?: ActivationExpire;
};

export function fetchPlanActivations(input: ActivationQuery) {
  return getList<PlanActivation>(
    `/api/admin/plan-activations${query({
      page: input.page,
      size: input.size,
      user_id: input.userId,
      plan_id: input.planId,
      expire: input.expire,
    })}`,
  );
}

/** 单个用户的续费流水（数据源是账本里 source=subscription 的行） */
export function fetchPlanActivationHistory(userId: number, input: { page: number; size: number }) {
  return getList<PlanActivationHistoryItem>(
    `/api/admin/plan-activations/${userId}/history${query({
      page: input.page,
      size: input.size,
    })}`,
  );
}

/* -------------------------------------------------------------- 写接口 */

export function createPlan(input: PlanInput) {
  return postData<Plan>("/api/admin/plans", input);
}

/** 整体替换，input 必须带齐全部字段 */
export function updatePlan(id: number, input: PlanInput) {
  return putOk(`/api/admin/plans/${id}`, input);
}

/** 软删：status 置 0，同时物理删掉名下 plan_prices */
export function disablePlan(id: number) {
  return deleteOk(`/api/admin/plans/${id}`);
}

/** 恢复软删：status 置回 1。已经在售时后端也回 200（幂等），前端不必先判状态 */
export function restorePlan(id: number) {
  return postOk(`/api/admin/plans/${id}/enable`);
}

export function createPlanPrice(planId: number, input: PlanPriceInput) {
  return postData<PlanPrice>(`/api/admin/plans/${planId}/prices`, input);
}

export function deletePlanPrice(priceId: number) {
  return deleteOk(`/api/admin/plan_prices/${priceId}`);
}

/* ---------------------------------------------------------- 表单取值 */

export type PlanFormValues = {
  name: string;
  mode: string;
  pricingMode: string;
  markupMultiplier: string;
  quotaKind: string;
  quotaAmount: string;
  quotaPeriodDays: string;
  overageMode: string;
  price: string;
  currency: string;
  /** 一行一条卖点 */
  features: string;
  recommended: boolean;
  sortOrder: string;
  rateRules?: unknown;
};

export type BuildResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** 十进制输入转数字：空串表示未填，交给调用方决定默认值；其余必须是无符号小数 */
function parseDecimal(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** 整数输入转数字：允许负号，因为 sort_order 可以是负数 */
function parseIntStrict(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  if (!/^-?\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

function decimalProblem(
  value: number,
  label: string,
  spec: { precision: number; scale: number } = MONEY,
) {
  if (!fitsDecimal(value, spec.precision, spec.scale)) {
    return `${label}超出可表示范围（整数部分最多 ${spec.precision - spec.scale} 位）`;
  }
  return null;
}

/**
 * 表单 -> 请求体。校验口径与后端 parsePlanInput 对齐，能在前端拦住的就不发请求。
 *
 * 订阅制的 quota_amount 与 quota_period_days 必须大于 0，后端会 400，
 * 这里先拦一次，管理员不用等一轮往返才知道填错了。
 */
export function buildPlanInput(values: PlanFormValues): BuildResult<PlanInput> {
  const name = values.name.trim();
  if (!name) return { ok: false, message: "套餐名不能为空" };
  if (name.length > 64) return { ok: false, message: "套餐名不能超过 64 个字符" };

  if (!oneOf(values.mode, ["pay_as_you_go", "subscription"] as const)) {
    return { ok: false, message: "计费模式只能是按量付费或订阅制" };
  }
  const mode = values.mode;

  if (!oneOf(values.pricingMode, ["markup", "table"] as const)) {
    return { ok: false, message: "定价方式只能是成本倍率或逐模型定价" };
  }
  const pricingMode = values.pricingMode;

  if (!oneOf(values.quotaKind, ["money", "requests"] as const)) {
    return { ok: false, message: "额度单位只能是金额或次数" };
  }
  const quotaKind = values.quotaKind;

  if (!oneOf(values.overageMode, ["disabled", "bill"] as const)) {
    return { ok: false, message: "超额处理只能是停用或继续计费" };
  }
  const overageMode = values.overageMode;

  // 成本倍率：留空按 1
  const multiplier = parseDecimal(values.markupMultiplier) ?? (values.markupMultiplier.trim() ? null : 1);
  if (multiplier === null || multiplier <= 0) {
    return { ok: false, message: "成本倍率必须是大于 0 的数字" };
  }
  const multiplierProblem = decimalProblem(multiplier, "成本倍率");
  if (multiplierProblem) return { ok: false, message: multiplierProblem };

  // 价格：留空按 0
  const price = parseDecimal(values.price) ?? (values.price.trim() ? null : 0);
  if (price === null || price < 0) return { ok: false, message: "价格必须是非负数字" };
  const priceProblem = decimalProblem(price, "价格");
  if (priceProblem) return { ok: false, message: priceProblem };

  const quotaAmount = parseDecimal(values.quotaAmount) ?? (values.quotaAmount.trim() ? null : 0);
  if (quotaAmount === null || quotaAmount < 0) {
    return { ok: false, message: "额度数量必须是非负数字" };
  }
  const amountProblem = decimalProblem(quotaAmount, "额度数量", PRICE);
  if (amountProblem) return { ok: false, message: amountProblem };

  const periodDays = parseIntStrict(values.quotaPeriodDays) ?? (values.quotaPeriodDays.trim() ? null : 0);
  if (periodDays === null || periodDays < 0) {
    return { ok: false, message: "额度周期必须是大于等于 0 的整数天" };
  }
  if (!fitsInt32(periodDays)) return { ok: false, message: "额度周期超出 32 位整数范围" };

  const sortOrder = parseIntStrict(values.sortOrder) ?? (values.sortOrder.trim() ? null : 0);
  if (sortOrder === null) return { ok: false, message: "排列顺序必须是整数" };
  if (!fitsInt32(sortOrder)) return { ok: false, message: "排列顺序超出 32 位整数范围" };

  if (mode === "subscription" && quotaAmount <= 0) {
    return { ok: false, message: "订阅套餐的额度数量必须大于 0" };
  }
  if (mode === "subscription" && periodDays <= 0) {
    return { ok: false, message: "订阅套餐的额度周期必须大于 0 天" };
  }

  const currency = values.currency.trim().toUpperCase();
  if (currency.length !== 3) return { ok: false, message: "币种必须是 3 个字母，例如 CNY" };

  const features = values.features
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  const value: PlanInput = {
    name,
    mode,
    pricing_mode: pricingMode,
    markup_multiplier: multiplier,
    quota_kind: quotaKind,
    quota_amount: quotaAmount,
    quota_period_days: periodDays,
    overage_mode: overageMode,
    price,
    currency,
    features,
    recommended: values.recommended,
    sort_order: sortOrder,
  };
  if (values.rateRules !== undefined) value.rate_rules = values.rateRules;

  return { ok: true, value };
}

export type PriceFormValues = {
  model: string;
  costMode: string;
  inputPerMillion: string;
  outputPerMillion: string;
  cacheReadPerMillion: string;
  cacheWritePerMillion: string;
  perRequest: string;
  requestWeight: string;
};

/** 一条模型价的表单 -> 请求体。金额字段留空按 0，request_weight 留空按 1 */
export function buildPriceInput(values: PriceFormValues): BuildResult<PlanPriceInput> {
  const model = values.model.trim();
  if (!model) return { ok: false, message: "模型名不能为空" };
  if (model.length > 128) return { ok: false, message: "模型名不能超过 128 个字符" };

  if (!oneOf(values.costMode, ["token", "request"] as const)) {
    return { ok: false, message: "计费方式只能是按 Token 或按次" };
  }

  type MoneyKey = Exclude<keyof PlanPriceInput, "model" | "cost_mode">;
  const fields: { key: MoneyKey; label: string; raw: string; fallback: number }[] = [
    { key: "input_per_million", label: "输入单价", raw: values.inputPerMillion, fallback: 0 },
    { key: "output_per_million", label: "输出单价", raw: values.outputPerMillion, fallback: 0 },
    { key: "cache_read_per_million", label: "缓存读单价", raw: values.cacheReadPerMillion, fallback: 0 },
    { key: "cache_write_per_million", label: "缓存写单价", raw: values.cacheWritePerMillion, fallback: 0 },
    { key: "per_request", label: "每次调用单价", raw: values.perRequest, fallback: 0 },
    { key: "request_weight", label: "请求权重", raw: values.requestWeight, fallback: 1 },
  ];

  const value: PlanPriceInput = {
    model,
    cost_mode: values.costMode,
    input_per_million: 0,
    output_per_million: 0,
    cache_read_per_million: 0,
    cache_write_per_million: 0,
    per_request: 0,
    request_weight: 1,
  };

  for (const field of fields) {
    const parsed = parseDecimal(field.raw) ?? (field.raw.trim() ? null : field.fallback);
    if (parsed === null || parsed < 0) return { ok: false, message: `${field.label}必须是非负数字` };
    const problem = decimalProblem(parsed, field.label, PRICE);
    if (problem) return { ok: false, message: problem };
    value[field.key] = parsed;
  }

  if (value.request_weight <= 0) return { ok: false, message: "请求权重必须大于 0" };

  return { ok: true, value };
}

/* -------------------------------------------------------------- 显示口径 */

const CURRENCY_SYMBOLS: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€", JPY: "¥" };

export function currencySymbol(currency: string) {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
}

/** 套餐价格：整数不带小数尾巴，小数最多两位 */
export function formatPlanMoney(value: number, currency: string) {
  if (!Number.isFinite(value)) return `${currencySymbol(currency)}0`;
  return `${currencySymbol(currency)}${value.toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * 卡片上那句额度描述，由额度口径拼出来，不再是写死的营销文案。
 * 按量付费没有周期，直接说按量扣减。
 */
export function planQuotaText(plan: Plan) {
  if (plan.mode !== "subscription") return "没有月费，用多少算多少，余额实时扣减。";
  const unit = plan.quota_kind === "requests" ? "次调用" : "元额度";
  const amount =
    plan.quota_kind === "requests"
      ? plan.quota_amount.toLocaleString("zh-CN")
      : String(plan.quota_amount);
  const overage = plan.overage_mode === "bill" ? "超出部分继续计费" : "超额停用，不另行扣费";
  return `每 ${plan.quota_period_days} 天含 ${amount} ${unit}，${overage}。`;
}
