import {
  bigint,
  boolean,
  datetime,
  decimal,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  text,
  tinyint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * 用户表。
 *
 * 字段对齐线上 mysql `sales`.`users`（name / role / status / credit_limit / plan_id /
 * token_version 都是那边就有的），另加一个 source 列标记记录来源 ——
 * 线上有两套用户表，导入到本地时混在了一起：
 *
 *   source = "tokenmp_next"  261 条，来自 postgres 的 tokenmp_next.users（用户端）
 *   source = "sales"         1 条，来自 mysql 的 sales.users（控制台管理员）
 *   source = "local"         本地注册的
 *
 * password_hash 存的是线上原样的 bcrypt 哈希，不做二次哈希，
 * 所以线上用户拿原密码就能登录。
 */
export const users = mysqlTable("users", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  email: varchar("email", { length: 191 }),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: varchar("role", { length: 16 }).notNull().default("user"),
  /** 1 = 正常，0 = 停用，沿用线上 sales 的约定 */
  status: tinyint("status").notNull().default(1),
  creditLimit: decimal("credit_limit", { precision: 14, scale: 8 }).notNull().default("0"),
  /** 可用余额（元）。调账、订阅、用量扣费都改这一列 */
  balance: decimal("balance", { precision: 14, scale: 8 }).notNull().default("0"),
  /** 已用掉的信用额度。剩余信用 = creditLimit - creditUsed */
  creditUsed: decimal("credit_used", { precision: 14, scale: 8 }).notNull().default("0"),
  planId: bigint("plan_id", { mode: "number", unsigned: true }),
  /** 改密码时自增，让已经签发的会话失效 */
  tokenVersion: bigint("token_version", { mode: "number" }).notNull().default(0),
  source: varchar("source", { length: 16 }).notNull().default("local"),
  createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull(),
  updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull(),
});

export type UserRow = typeof users.$inferSelect;

/** 键值配置。系统版本号存在这里，key = 'system_version' */
export const systemConfig = mysqlTable("system_config", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: json("value").notNull(),
  updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull(),
});

/**
 * 公告，面向全站。
 *   severity  info / warning / urgent
 *   status    draft / published / archived
 * 线上「v0.1.0 正式发布」就是用公告发的，所以版本说明不用另建表。
 */
export const announcements = mysqlTable("announcements", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  severity: varchar("severity", { length: 32 }).notNull().default("info"),
  scope: varchar("scope", { length: 64 }).notNull().default("all"),
  /** 用户能不能自己关掉 */
  dismissible: boolean("dismissible").notNull().default(true),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  sortOrder: int("sort_order").notNull().default(0),
  publishFrom: datetime("publish_from", { mode: "date", fsp: 3 }).notNull(),
  /** 为空表示一直有效 */
  publishUntil: datetime("publish_until", { mode: "date", fsp: 3 }),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull(),
  updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull(),
});

/**
 * 通知，面向单个用户。
 *   type            业务类型，前端拿去挑图标
 *   readAt          为空即未读
 *   idempotencyKey  同一个业务事件重复投递时靠它去重
 */
export const notifications = mysqlTable("notifications", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  type: varchar("type", { length: 64 }).notNull().default(""),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body"),
  severity: varchar("severity", { length: 32 }).notNull().default("info"),
  actionLabel: varchar("action_label", { length: 128 }),
  actionUrl: varchar("action_url", { length: 512 }),
  metadata: json("metadata"),
  readAt: datetime("read_at", { mode: "date", fsp: 3 }),
  expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }),
  idempotencyKey: varchar("idempotency_key", { length: 128 }),
  createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull(),
});

/** 用户关掉了哪条公告，免得换台设备又把关过的弹出来 */
export const announcementDismissals = mysqlTable(
  "announcement_dismissals",
  {
    userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
    announcementId: bigint("announcement_id", { mode: "number", unsigned: true }).notNull(),
    dismissedAt: datetime("dismissed_at", { mode: "date", fsp: 3 }).notNull(),
  },
  table => [primaryKey({ columns: [table.userId, table.announcementId] })],
);

/* -------------------------------------------------------- 业务：余额与密钥 */

/**
 * 预算封顶。存与展示在本地，判定在网关侧。
 * enabled=false 或 amount=0 都表示没设，两个条件都要判。
 */
export const userBudgets = mysqlTable("user_budgets", {
  userId: bigint("user_id", { mode: "number", unsigned: true }).primaryKey(),
  enabled: tinyint("enabled").notNull().default(0),
  amount: decimal("amount", { precision: 14, scale: 8 }).notNull().default("0"),
  period: varchar("period", { length: 8 }).notNull().default("month"),
  periodStart: datetime("period_start", { mode: "date", fsp: 3 }),
  periodEnd: datetime("period_end", { mode: "date", fsp: 3 }),
  used: decimal("used", { precision: 14, scale: 8 }).notNull().default("0"),
  /** 改动时自增，网关拿它判断缓存的预算是否过期 */
  version: bigint("version", { mode: "number" }).notNull().default(0),
  createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull(),
  updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull(),
});

export type UserBudgetRow = typeof userBudgets.$inferSelect;

/**
 * API 密钥。只存 sha256，明文只在签发那一次返回。
 * keyPrefix 是明文前 9 位，keySuffix 是末 6 位，列表里靠这两段辨识。
 */
export const apiKeys = mysqlTable(
  "api_keys",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
    name: varchar("name", { length: 64 }),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
    keySuffix: varchar("key_suffix", { length: 8 }),
    /** 1 = 正常，0 = 已停用 */
    status: tinyint("status").notNull().default(1),
    modelWhitelist: json("model_whitelist"),
    rateLimitPerMin: int("rate_limit_per_min"),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }),
    /** 网关回写，本地签发时为空 */
    lastUsedAt: datetime("last_used_at", { mode: "date", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull(),
  },
  table => [uniqueIndex("uk_api_keys_hash").on(table.keyHash), index("idx_api_keys_user").on(table.userId, table.createdAt)],
);

export type ApiKeyRow = typeof apiKeys.$inferSelect;

/**
 * 余额流水。balanceAfter 存快照而不是算出来，对账时要能复现那一刻的账户状态。
 * source: recharge 充值、adjust 调账、usage 用量扣费、channel_share 分享返额、subscription 订阅扣款。
 */
export const creditTransactions = mysqlTable(
  "credit_transactions",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
    delta: decimal("delta", { precision: 14, scale: 8 }).notNull(),
    balanceAfter: decimal("balance_after", { precision: 14, scale: 8 }).notNull(),
    creditUsedAfter: decimal("credit_used_after", { precision: 14, scale: 8 }).notNull().default("0"),
    source: varchar("source", { length: 16 }).notNull(),
    refId: varchar("ref_id", { length: 64 }),
    reason: varchar("reason", { length: 256 }),
    operator: varchar("operator", { length: 64 }),
    model: varchar("model", { length: 128 }),
    totalTokens: bigint("total_tokens", { mode: "number" }),
    /** 这次变动落在余额上的部分，符号与 delta 同向 */
    balancePart: decimal("balance_part", { precision: 14, scale: 8 }).notNull().default("0"),
    /** 落在信用额度上的部分 */
    creditPart: decimal("credit_part", { precision: 14, scale: 8 }).notNull().default("0"),
    /** 扣的是订阅额度还是余额，用量类流水才有 */
    ledger: varchar("ledger", { length: 16 }),
    detail: json("detail"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull(),
  },
  table => [
    index("idx_ct_user").on(table.userId, table.createdAt),
    index("idx_ct_source").on(table.source, table.createdAt),
    index("idx_ct_ref").on(table.refId),
  ],
);

export type CreditTransactionRow = typeof creditTransactions.$inferSelect;

/* ------------------------------------------------------------ 业务：套餐 */

/**
 * 套餐。字段照 openapi 的 PlanCore，另加 features（销售页卖点）、
 * recommended（推荐标）与 sortOrder（排列顺序）三个本机扩展。
 * 订阅数不存列，从 subscriptions 现算。删是软删 status=0。
 */
export const plans = mysqlTable(
  "plans",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    name: varchar("name", { length: 64 }).notNull(),
    /** pay_as_you_go 按量付费 | subscription 订阅制 */
    mode: varchar("mode", { length: 24 }).notNull(),
    /** markup 按成本乘倍率 | table 按 plan_prices 逐模型定价 */
    pricingMode: varchar("pricing_mode", { length: 16 }).notNull(),
    markupMultiplier: decimal("markup_multiplier", { precision: 14, scale: 8 }).notNull().default("1"),
    rateRules: json("rate_rules"),
    quotaKind: varchar("quota_kind", { length: 16 }).notNull().default("money"),
    quotaAmount: decimal("quota_amount", { precision: 18, scale: 8 }).notNull().default("0"),
    quotaPeriodDays: int("quota_period_days").notNull().default(30),
    /** disabled 超额停用 | bill 超额继续计费 */
    overageMode: varchar("overage_mode", { length: 16 }).notNull().default("disabled"),
    price: decimal("price", { precision: 14, scale: 8 }).notNull().default("0"),
    currency: varchar("currency", { length: 3 }).notNull().default("CNY"),
    /** 0 表示已删 */
    status: tinyint("status").notNull().default(1),
    features: json("features"),
    recommended: tinyint("recommended").notNull().default(0),
    sortOrder: int("sort_order").notNull().default(0),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull(),
  },
  table => [uniqueIndex("uk_plans_name").on(table.name)],
);

export type PlanRow = typeof plans.$inferSelect;

/** 套餐里针对单个模型的定价，pricingMode=table 的套餐才用得上 */
export const planPrices = mysqlTable(
  "plan_prices",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    planId: bigint("plan_id", { mode: "number", unsigned: true }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    /** token 按量 | request 按次 */
    costMode: varchar("cost_mode", { length: 16 }).notNull().default("token"),
    inputPerMillion: decimal("input_per_million", { precision: 18, scale: 8 }).notNull().default("0"),
    outputPerMillion: decimal("output_per_million", { precision: 18, scale: 8 }).notNull().default("0"),
    cacheReadPerMillion: decimal("cache_read_per_million", { precision: 18, scale: 8 })
      .notNull()
      .default("0"),
    cacheWritePerMillion: decimal("cache_write_per_million", { precision: 18, scale: 8 })
      .notNull()
      .default("0"),
    perRequest: decimal("per_request", { precision: 18, scale: 8 }).notNull().default("0"),
    requestWeight: decimal("request_weight", { precision: 14, scale: 8 }).notNull().default("1"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull(),
  },
  table => [uniqueIndex("uk_plan_prices_model").on(table.planId, table.model)],
);

export type PlanPriceRow = typeof planPrices.$inferSelect;

/**
 * 订阅记录，一次激活一行，续费再加一行。
 * 当前订阅 = 该用户 status='active' 且 period_end 最晚的那行。
 * quotaUsed 由网关按用量回填，本地订阅时从 0 起。
 */
export const subscriptions = mysqlTable(
  "subscriptions",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
    planId: bigint("plan_id", { mode: "number", unsigned: true }).notNull(),
    amount: decimal("amount", { precision: 14, scale: 8 }).notNull().default("0"),
    quotaKind: varchar("quota_kind", { length: 16 }).notNull().default("money"),
    quotaLimit: decimal("quota_limit", { precision: 18, scale: 8 }).notNull().default("0"),
    quotaUsed: decimal("quota_used", { precision: 18, scale: 8 }).notNull().default("0"),
    periodStart: datetime("period_start", { mode: "date", fsp: 3 }),
    periodEnd: datetime("period_end", { mode: "date", fsp: 3 }),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull(),
  },
  table => [
    index("idx_subscriptions_user").on(table.userId, table.periodEnd),
    index("idx_subscriptions_plan").on(table.planId),
    index("idx_subscriptions_status").on(table.status, table.periodEnd),
    index("idx_subscriptions_created").on(table.createdAt),
  ],
);

export type SubscriptionRow = typeof subscriptions.$inferSelect;

/* ------------------------------------------- 业务：调用记录、计费、充值单 */

/**
 * 一次调用的记录（含失败）。字段照 openapi 的 RequestRecord。
 * 数据的产生方是转发内核，本机只负责存与查；requestId 是摄入时的幂等键。
 */
export const requestRecords = mysqlTable(
  "request_records",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    userId: bigint("user_id", { mode: "number", unsigned: true }),
    apiKeyId: bigint("api_key_id", { mode: "number", unsigned: true }),
    model: varchar("model", { length: 128 }),
    servedModel: varchar("served_model", { length: 128 }),
    entry: varchar("entry", { length: 32 }),
    stream: tinyint("stream").notNull().default(0),
    channel: varchar("channel", { length: 128 }),
    channelType: varchar("channel_type", { length: 32 }),
    baseUrl: varchar("base_url", { length: 512 }),
    status: varchar("status", { length: 16 }).notNull().default("in_progress"),
    httpStatus: int("http_status"),
    errorMessage: text("error_message"),
    errorCode: varchar("error_code", { length: 64 }),
    renderStatus: int("render_status"),
    upstreamCode: varchar("upstream_code", { length: 64 }),
    upstreamMessage: text("upstream_message"),
    panelMessage: text("panel_message"),
    attempts: int("attempts"),
    retried: tinyint("retried"),
    userAgent: varchar("user_agent", { length: 512 }),
    reasoningEffort: varchar("reasoning_effort", { length: 32 }),
    latencyMs: int("latency_ms"),
    ttfbMs: int("ttfb_ms"),
    tps: decimal("tps", { precision: 14, scale: 4 }),
    promptTokens: bigint("prompt_tokens", { mode: "number" }),
    completionTokens: bigint("completion_tokens", { mode: "number" }),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }),
    cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }),
    totalTokens: bigint("total_tokens", { mode: "number" }),
    startedAt: datetime("started_at", { mode: "date", fsp: 3 }),
    finishedAt: datetime("finished_at", { mode: "date", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull(),
  },
  table => [
    uniqueIndex("uk_request_records_request").on(table.requestId),
    index("idx_request_records_user").on(table.userId, table.createdAt),
    index("idx_request_records_model").on(table.model, table.createdAt),
    index("idx_request_records_status").on(table.status, table.createdAt),
  ],
);

export type RequestRecordRow = typeof requestRecords.$inferSelect;

/**
 * 计费流水。与调用记录一对一，但只对成功的调用产生。
 * cost_* 是付给上游的成本，revenue_* 是向用户收的钱。
 */
export const billingRecords = mysqlTable(
  "billing_records",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    userId: bigint("user_id", { mode: "number", unsigned: true }),
    apiKeyId: bigint("api_key_id", { mode: "number", unsigned: true }),
    planId: bigint("plan_id", { mode: "number", unsigned: true }),
    channelId: bigint("channel_id", { mode: "number", unsigned: true }),
    channelName: varchar("channel_name", { length: 128 }),
    ownerUserId: bigint("owner_user_id", { mode: "number", unsigned: true }),
    entry: varchar("entry", { length: 32 }),
    model: varchar("model", { length: 128 }),
    stream: tinyint("stream").notNull().default(0),
    usageSource: varchar("usage_source", { length: 32 }),
    chargeMode: varchar("charge_mode", { length: 32 }),
    costMultiplier: decimal("cost_multiplier", { precision: 14, scale: 8 }).notNull().default("1"),
    costMultiplierRules: json("cost_multiplier_rules"),
    costAmount: decimal("cost_amount", { precision: 18, scale: 8 }).notNull().default("0"),
    revenueMultiplier: decimal("revenue_multiplier", { precision: 14, scale: 8 }).notNull().default("1"),
    revenueMultiplierRules: json("revenue_multiplier_rules"),
    revenueAmount: decimal("revenue_amount", { precision: 18, scale: 8 }).notNull().default("0"),
    ownerCreditAmount: decimal("owner_credit_amount", { precision: 18, scale: 8 }).notNull().default("0"),
    currency: varchar("currency", { length: 3 }).notNull().default("CNY"),
    billingMode: varchar("billing_mode", { length: 32 }),
    ledger: varchar("ledger", { length: 16 }),
    latencyMs: int("latency_ms"),
    httpStatus: int("http_status"),
    attempts: int("attempts"),
    retried: tinyint("retried"),
    status: varchar("status", { length: 16 }).notNull().default("settled"),
    promptTokens: bigint("prompt_tokens", { mode: "number" }).notNull().default(0),
    completionTokens: bigint("completion_tokens", { mode: "number" }).notNull().default(0),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }).notNull().default(0),
    cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }).notNull().default(0),
    totalTokens: bigint("total_tokens", { mode: "number" }).notNull().default(0),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull(),
  },
  table => [
    uniqueIndex("uk_billing_records_request").on(table.requestId),
    index("idx_billing_records_user").on(table.userId, table.createdAt),
    index("idx_billing_records_model").on(table.model, table.createdAt),
    index("idx_billing_records_channel").on(table.channelId, table.createdAt),
  ],
);

export type BillingRecordRow = typeof billingRecords.$inferSelect;

/** 充值单。管理员代充不经过它，那条路直接记 creditTransactions */
export const rechargeOrders = mysqlTable(
  "recharge_orders",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    orderNo: varchar("order_no", { length: 64 }).notNull(),
    userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
    amount: decimal("amount", { precision: 14, scale: 8 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("CNY"),
    channel: varchar("channel", { length: 24 }).notNull().default("mock"),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    externalNo: varchar("external_no", { length: 128 }),
    paidAt: datetime("paid_at", { mode: "date", fsp: 3 }),
    creditTransactionId: bigint("credit_transaction_id", { mode: "number", unsigned: true }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull(),
  },
  table => [
    uniqueIndex("uk_recharge_orders_no").on(table.orderNo),
    index("idx_recharge_orders_user").on(table.userId, table.createdAt),
    index("idx_recharge_orders_external").on(table.channel, table.externalNo),
  ],
);

export type RechargeOrderRow = typeof rechargeOrders.$inferSelect;
