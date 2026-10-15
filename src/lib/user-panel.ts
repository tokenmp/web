/**
 * 用户面板的客户端数据层。
 *
 * 字段名照 openapi.yaml 的 UserPanel 那组端点（线上是 snake_case，这里保持），
 * 请求与错误信封复用 src/lib/api-client.ts —— 页面不直接写 fetch。
 * 金额单位是元，展示时用 utils 的 formatPoints 换成积分（1 元 = 10000 积分）。
 *
 * 两处跟通用约定不一样的地方都收在这里：
 *   - /user/credits 的 total 在 data 里，因此用 getData 而不是 getList；
 *   - 订阅余额不足后端回 402，不是普通的失败，调用方要用 isInsufficientBalance 分开处理。
 */

import {
  ApiError,
  deleteOk,
  getData,
  getList,
  postData,
  postOk,
  query,
} from "./api-client";
import { pickCurrentPlan } from "./current-plan";

export { ApiError };

/** 订阅时余额不够的 HTTP 状态码，openapi 在 /user/plans/{id}/subscribe 上写死 */
export const INSUFFICIENT_BALANCE_STATUS = 402;

/**
 * 余额不足不是「操作失败」，而是一句需要说清楚的话（去充值）。
 * 返回 true 时调用方应该显示专门的提示，别套用通用的错误样式。
 */
export function isInsufficientBalance(err: unknown) {
  return err instanceof ApiError && err.status === INSUFFICIENT_BALANCE_STATUS;
}

/* ------------------------------------------------------------ 个人中心 */

export type PanelBudget = {
  amount: number;
  period: string;
  used: number;
  remaining: number;
};

export type PanelMe = {
  id: number;
  name: string;
  email: string | null;
  /** 1 = 正常，0 = 停用 */
  status: number;
  role: string;
  /** 授信（元） */
  credit_limit: number;
  /** 剩余授信 = credit_limit - credit_used */
  credit_available: number;
  plan_id: number | null;
  /** 余额（元） */
  balance: number;
  created_at: string;
  updated_at: string;
  budget: PanelBudget | null;
};

export function fetchMe() {
  return getData<PanelMe>("/api/user/me");
}

/**
 * POST /api/auth/password
 *
 * 改完密码后端会把 token_version 加一，其他设备上的会话随即失效；
 * 当前这一台由后端重签一个新 token 并重写 cookie，所以这里不需要处理返回值 ——
 * 浏览器自动带上新的 Set-Cookie，用户不会改完就被踢下线。
 */
export function changePassword(input: { old_password: string; new_password: string }) {
  return postData<{ token: string }>("/api/auth/password", input);
}

/* ------------------------------------------------------------ 我的密钥 */

export type PanelApiKey = {
  id: number;
  user_id: number;
  name: string | null;
  key_prefix: string;
  /** 明文只在不落库那次响应里出现，列表只有前后缀 */
  key_suffix: string | null;
  status: number;
  model_whitelist: string[] | null;
  rate_limit_per_min: number | null;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PanelKeyList = { items: PanelApiKey[]; total: number };

export const emptyKeys: PanelKeyList = { items: [], total: 0 };

/** 列表端点，total 在顶层，用 getList */
export function fetchApiKeys() {
  return getList<PanelApiKey>("/api/user/api_keys");
}

type NewApiKeyInput = {
  name?: string;
  /** ISO 时间字符串；不传表示永不过期 */
  expires_at?: string;
};

export type CreatedApiKey = {
  id: number;
  name: string | null;
  /** 明文，只此一次 */
  key: string;
  key_prefix: string;
  key_suffix: string | null;
  expires_at: string | null;
};

export function createApiKey(input: NewApiKeyInput) {
  return postData<CreatedApiKey>("/api/user/api_keys", input);
}

export function deleteApiKey(id: number) {
  return deleteOk(`/api/user/api_keys/${id}`);
}

/* ---------------------------------------------------------- 余额流水 */

export type PanelTransaction = {
  id: number;
  user_id: number;
  /** 正数入账、负数扣款（元） */
  delta: number;
  balance_after: number;
  source: string;
  ref_id: string | null;
  created_at: string;
  /** 原样透出的 JSON，可能是字符串也可能是对象 */
  detail: unknown;
  model: string | null;
  total_tokens: number | null;
  /** 落在余额上的部分，符号与 delta 同向 */
  balance_part: number;
  /** 落在授信上的部分 */
  credit_part: number;
};

export type PanelCredits = {
  balance: number;
  credit_limit: number;
  credit_available: number;
  /** 注意：这个 total 在 data 里，不在响应顶层 */
  total: number;
  transactions: PanelTransaction[];
};

export const emptyCredits: PanelCredits = {
  balance: 0,
  credit_limit: 0,
  credit_available: 0,
  total: 0,
  transactions: [],
};

/** GET /user/credits。total 在 data 内（openapi 明写的例外），所以用 getData */
export function fetchCredits(input: { page: number; size: number }) {
  return getData<PanelCredits>(`/api/user/credits${query(input)}`);
}

/* ------------------------------------------------------------ 套餐订阅 */

export type PanelPlan = {
  id: number;
  name: string;
  mode: "subscription" | "pay_as_you_go";
  quota_kind: "money" | "requests";
  pricing_mode: "markup" | "table";
  markup_multiplier: number;
  price: number;
  quota_amount: number;
  quota_period_days: number;
  overage_mode: "disabled" | "bill";
  currency: string;
  model_count: number;
  weight_min: number;
  weight_max: number;
  updated_at: string;
};

export type PanelCurrentPlan = {
  plan: PanelPlan;
  quota_limit: number;
  quota_used: number;
  period_start: string | null;
  period_end: string | null;
};

export type PanelPlans = {
  plans: PanelPlan[];
  current: PanelCurrentPlan | null;
  default_plan_id: number | null;
};

export const emptyPlans: PanelPlans = { plans: [], current: null, default_plan_id: null };

export function fetchPlans() {
  return getData<PanelPlans>("/api/user/plans");
}

/** 订阅/续费。没有请求体；余额不足抛 ApiError(402) */
export function subscribePlan(id: number) {
  return postOk(`/api/user/plans/${id}/subscribe`);
}

/**
 * 面板上要显示的套餐。
 *
 * 后台用户详情里的「套餐」下拉写的是 users.plan_id（绑定），用户自助订阅才写一条
 * subscriptions 行（周期与订阅额度），二者是可以分开的：只绑定、没订阅时 /user/plans
 * 的 current 是空的，面板上就什么都不显示 —— 后台刚给用户绑上套餐，切到用户面板
 * 却看不到，说的就是这一种。
 *
 * 这里把两种情形合起来：有生效订阅以订阅为准，只有绑定就退回绑定的那一档，
 * subscription 为 null 表示「绑了套餐，还没有订阅额度」。判据本体在
 * src/lib/current-plan.ts，服务端算计价口径时用的是同一份。
 */
export type PanelPlanState = {
  plan: PanelPlan;
  subscription: Omit<PanelCurrentPlan, "plan"> | null;
};

/**
 * boundPlanId 传 GET /user/me 的 plan_id，不要用 /user/plans 的 default_plan_id ——
 * 后者在用户没绑套餐时会退到按量付费那一档，拿来当「已绑定」用会认错。
 */
export function resolvePanelPlan(
  data: PanelPlans,
  boundPlanId: number | null | undefined,
): PanelPlanState | null {
  let bySubscription: PanelPlanState | null = null;
  if (data.current) {
    const { plan, ...subscription } = data.current;
    bySubscription = { plan, subscription };
  }

  // 绑的那一档已经下架时不在在售列表里（列表只回 status=1），这里取不到，只能照旧不显示
  const bound =
    boundPlanId === null || boundPlanId === undefined
      ? null
      : data.plans.find(plan => plan.id === boundPlanId) ?? null;

  // 判据与内部密钥校验端点共用，见 src/lib/current-plan.ts
  return pickCurrentPlan(bySubscription, bound ? { plan: bound, subscription: null } : null);
}
