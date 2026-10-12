/**
 * 客户端密钥校验：拿密钥明文换身份与计价口径。
 *
 * 转发内核在转发路径上调这个（每个缓存周期一次），要拿到三样东西：
 * 这次调用算在哪个用户、哪把密钥头上；要不要拦（停用、过期）；收多少钱的计价口径。
 * 前两样在本机的 api_keys 与 users 里，第三样挂在用户当前套餐上，都在这里查。
 *
 * 密钥比对走 sha256 一次索引查询：api_keys.key_hash 存的就是 sha256，
 * 上面有唯一索引 uk_api_keys_hash，一次查询命中一行。这条路径在转发链路上、
 * 调用量大，不能用 bcrypt —— 那要对候选行逐条比，代价高几个数量级，
 * 而且这里存的是摘要而不是口令，没有加盐慢哈希的必要。
 *
 * 上游成本单价（付给上游每百万 token 多少）web 这边还没有出处，
 * 所以这里只给收入侧的计价口径；成本单价的来源在 tokenmp/cli#34 定。
 *
 * 这个端点不写库：api_keys.last_used_at 的注释写着「网关回写」，但转发路径每条请求
 * 都来一次，写它会把这一列打热，也把这个端点从只读变成写。要回写另开一条路。
 */

import { and, asc, desc, eq } from "drizzle-orm";

import type { PricingMode } from "./admin-plans";
import { pickCurrentPlan } from "./current-plan";
import { db } from "./db";
import { num } from "./http";
import { hashApiKey } from "./ledger";
import {
  apiKeys,
  planPrices,
  plans,
  subscriptions,
  users,
  type PlanRow,
  type SubscriptionRow,
} from "./schema";

/** plan_prices 的一行，去掉本地才用的 id、plan_id 与时间戳 */
export type PricingPrice = {
  model: string;
  cost_mode: string;
  input_per_million: number;
  output_per_million: number;
  cache_read_per_million: number;
  cache_write_per_million: number;
  per_request: number;
  request_weight: number;
};

/**
 * 该用户当前的计价口径。
 * 没有套餐（既没订阅也没绑定）时 plan_id、pricing_mode、markup_multiplier 都是 null，
 * prices 是空数组 —— 内核据此只推用量、不算钱。
 */
export type PricingSnapshot = {
  plan_id: number | null;
  pricing_mode: PricingMode | null;
  markup_multiplier: number | null;
  prices: PricingPrice[];
};

export type ApiKeyIdentity = {
  user_id: number;
  api_key_id: number;
  model_whitelist: string[] | null;
  rate_limit_per_min: number | null;
  expires_at: Date | null;
  pricing: PricingSnapshot;
};

/** 取不到身份的原因，由路由翻成 HTTP 状态码 */
export type ApiKeyLookupFailure = "unknown_key" | "key_disabled" | "user_disabled" | "expired";

export type ApiKeyLookupResult =
  | { ok: true; data: ApiKeyIdentity }
  | { ok: false; reason: ApiKeyLookupFailure };

/** 当前套餐：订出来的套餐，或只有绑定时那一档 */
type CurrentPlan = { plan: PlanRow; subscription: SubscriptionRow | null };

/**
 * model_whitelist 是 JSON 列，读回来是 unknown。内核要按字符串数组用，
 * 不是数组（或只有空白）就当没设，非字符串的项丢掉。
 */
function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : null;
}

/** 按 sha256 打唯一索引查一次。左连接 users，密钥还在、用户被删了也要能区分出来 */
async function findKeyWithUser(plain: string) {
  const [row] = await db
    .select({ key: apiKeys, user: users })
    .from(apiKeys)
    .leftJoin(users, eq(users.id, apiKeys.userId))
    .where(eq(apiKeys.keyHash, hashApiKey(plain)))
    .limit(1);
  return row ?? null;
}

/**
 * 生效订阅：status=active、period_end 最晚的那条。
 * 口径与 GET /user/plans 一致，那边也是这么取 current 的。
 */
async function activeSubscription(userId: number) {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
    .orderBy(desc(subscriptions.periodEnd))
    .limit(1);
  return row ?? null;
}

/** 订阅指向的套餐可能已经下架，不带 status 过滤：口径要跟面板一样「你现在订的是什么」 */
async function planOfSubscription(planId: number) {
  const [row] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  return row ?? null;
}

/** 绑定套餐只认在售的那一档：面板的列表只回 status=1，下架的绑定在面板上也不显示 */
async function onSalePlan(planId: number | null) {
  if (planId === null) return null;
  const [row] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.status, 1)))
    .limit(1);
  return row ?? null;
}

/** 当前套餐，判据与面板共用（src/lib/current-plan.ts） */
async function loadCurrentPlan(userId: number, boundPlanId: number | null): Promise<CurrentPlan | null> {
  const subscription = await activeSubscription(userId);
  const subscribedPlan = subscription ? await planOfSubscription(subscription.planId) : null;
  const boundPlan = await onSalePlan(boundPlanId);

  return pickCurrentPlan(
    subscribedPlan && subscription ? { plan: subscribedPlan, subscription } : null,
    boundPlan ? { plan: boundPlan, subscription: null } : null,
  );
}

/** 计价口径。markup 模式只给倍率，table 模式把该套餐的模型价全部给出 */
async function pricingSnapshot(plan: CurrentPlan | null): Promise<PricingSnapshot> {
  if (!plan) return { plan_id: null, pricing_mode: null, markup_multiplier: null, prices: [] };

  const mode: PricingMode = plan.plan.pricingMode === "table" ? "table" : "markup";
  const markupMultiplier = num(plan.plan.markupMultiplier);

  if (mode === "markup") {
    return { plan_id: plan.plan.id, pricing_mode: mode, markup_multiplier: markupMultiplier, prices: [] };
  }

  const rows = await db
    .select()
    .from(planPrices)
    .where(eq(planPrices.planId, plan.plan.id))
    .orderBy(asc(planPrices.model));

  return {
    plan_id: plan.plan.id,
    pricing_mode: mode,
    markup_multiplier: markupMultiplier,
    prices: rows.map(row => ({
      model: row.model,
      cost_mode: row.costMode,
      input_per_million: num(row.inputPerMillion),
      output_per_million: num(row.outputPerMillion),
      cache_read_per_million: num(row.cacheReadPerMillion),
      cache_write_per_million: num(row.cacheWritePerMillion),
      per_request: num(row.perRequest),
      request_weight: num(row.requestWeight),
    })),
  };
}

/**
 * 校验一把客户端密钥。
 *
 * 三种失败分开回：密钥不在 404，密钥或账号停用 403，密钥过期 410。
 * 内核据此决定拦不拦；本机只给事实，不做「该不该拦」的判断。
 */
export async function lookupApiKey(plain: string): Promise<ApiKeyLookupResult> {
  const row = await findKeyWithUser(plain);
  if (!row) return { ok: false, reason: "unknown_key" };

  const { key, user } = row;
  if (key.status !== 1) return { ok: false, reason: "key_disabled" };
  if (!user || user.status !== 1) return { ok: false, reason: "user_disabled" };
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const pricing = await pricingSnapshot(await loadCurrentPlan(user.id, user.planId));

  return {
    ok: true,
    data: {
      user_id: user.id,
      api_key_id: key.id,
      model_whitelist: stringList(key.modelWhitelist),
      rate_limit_per_min: key.rateLimitPerMin,
      expires_at: key.expiresAt,
      pricing,
    },
  };
}
