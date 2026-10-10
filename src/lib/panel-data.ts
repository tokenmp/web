/**
 * 用户面板的示例数据。
 *
 * 字段名照着 openapi.yaml 里 UserPanel 那组端点（线上是 snake_case，这里也保持），
 * 接后端时把数据来源换成 fetch 就行，页面不用动。金额单位是元，
 * 展示时用 utils 的 formatPoints 换算成积分 —— 跟线上一致（1 元 = 10000 积分）。
 *
 * 控制台的示例数据是各页内联的，面板这边集中放一个文件：十个页面共用同一批主体
 * （同一个用户、同一批模型、同一条时间线），散开写会出现「账单里是 A 模型、
 * 请求日志里是 B 模型」这种对不上的情况。
 *
 * 时间戳全部写死，不用 Date.now()：这些模块在服务端和浏览器都要跑一遍，
 * 用当前时间算出来的相对时间两边会对不上，水合就报错了。基准点取 2026-10-10
 * （跟控制台的示例数据同一天）。
 */

export const panelNow = new Date("2026-10-10T15:30:00+08:00").getTime();

const BASE = panelNow;

/** 基准时间往前 n 分钟 */
function minutesAgo(minutes: number) {
  return new Date(BASE - minutes * 60_000).toISOString();
}

/** 基准时间往前 n 天，可再带上小时：daysBefore(1, 9) = 前一天 09:00 */
function daysBefore(days: number, hour = 10, minute = 0) {
  const date = new Date(BASE - days * 86_400_000);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

/** 基准日期往前 n 天的 YYYY-MM-DD，用量趋势的横轴用 */
function dateBefore(days: number) {
  return new Date(BASE - days * 86_400_000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ 账户 */

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
  role: string;
  /** 1 = 正常，0 = 停用 */
  status: number;
  /** 余额（元） */
  balance: number;
  /** 授信额度（元） */
  credit_limit: number;
  /** 剩余信用 = credit_limit - 已用 */
  credit_available: number;
  plan_id: number | null;
  created_at: string;
  budget: PanelBudget | null;
};

/**
 * 登录用户就是这份示例数据的主人。
 * 概览页显示 `name` / `email` 时优先用会话里的真实用户，这里只用来演示
 * 余额、套餐这些本机还没有的数据。
 */
export const panelMe: PanelMe = {
  id: 263,
  name: "林知远",
  email: "lin.zy@example.com",
  role: "user",
  status: 1,
  balance: 428.65,
  credit_limit: 200,
  credit_available: 126.4,
  plan_id: 2,
  created_at: daysBefore(212, 8, 0),
  budget: { amount: 300, period: "month", used: 173.35, remaining: 126.65 },
};

/** 可用积分 = 余额 + 剩余信用，概览页第一个 KPI */
export function availablePoints(me: PanelMe = panelMe) {
  return me.balance + me.credit_available;
}

/* ------------------------------------------------------------ 用量与趋势 */

export type UsageModelSlice = {
  model: string;
  requests: number;
  tokens: number;
  revenue: number;
};

export type UsageDay = {
  date: string;
  requests: number;
  tokens: number;
  revenue: number;
  models?: UsageModelSlice[];
};

/** 近 7 日用量。堆叠柱按 models 分块，空日不给 models */
export const usageSeries: UsageDay[] = [
  {
    date: dateBefore(6),
    requests: 412,
    tokens: 1864220,
    revenue: 21.86,
    models: [
      { model: "gpt-4o-mini", requests: 218, tokens: 1024300, revenue: 4.12 },
      { model: "claude-sonnet-4", requests: 96, tokens: 512800, revenue: 12.31 },
      { model: "deepseek-v3", requests: 98, tokens: 327120, revenue: 5.43 },
    ],
  },
  {
    date: dateBefore(5),
    requests: 366,
    tokens: 1522670,
    revenue: 18.42,
    models: [
      { model: "gpt-4o-mini", requests: 196, tokens: 884000, revenue: 3.55 },
      { model: "claude-sonnet-4", requests: 74, tokens: 402600, revenue: 9.66 },
      { model: "deepseek-v3", requests: 96, tokens: 236070, revenue: 5.21 },
    ],
  },
  {
    date: dateBefore(4),
    requests: 508,
    tokens: 2418330,
    revenue: 31.24,
    models: [
      { model: "gpt-4o-mini", requests: 264, tokens: 1281400, revenue: 5.15 },
      { model: "claude-sonnet-4", requests: 128, tokens: 698200, revenue: 16.77 },
      { model: "gemini-2.5-pro", requests: 62, tokens: 302900, revenue: 6.08 },
      { model: "deepseek-v3", requests: 54, tokens: 135830, revenue: 3.24 },
    ],
  },
  {
    date: dateBefore(3),
    requests: 289,
    tokens: 1188490,
    revenue: 13.68,
    models: [
      { model: "gpt-4o-mini", requests: 158, tokens: 722400, revenue: 2.9 },
      { model: "claude-sonnet-4", requests: 52, tokens: 286100, revenue: 6.87 },
      { model: "deepseek-v3", requests: 79, tokens: 179990, revenue: 3.91 },
    ],
  },
  {
    date: dateBefore(2),
    requests: 631,
    tokens: 3104880,
    revenue: 42.19,
    models: [
      { model: "gpt-4o-mini", requests: 318, tokens: 1544200, revenue: 6.2 },
      { model: "claude-sonnet-4", requests: 164, tokens: 906300, revenue: 21.78 },
      { model: "gemini-2.5-pro", requests: 88, tokens: 462800, revenue: 9.3 },
      { model: "deepseek-v3", requests: 61, tokens: 191580, revenue: 4.91 },
    ],
  },
  {
    date: dateBefore(1),
    requests: 544,
    tokens: 2681330,
    revenue: 34.87,
    models: [
      { model: "gpt-4o-mini", requests: 276, tokens: 1338600, revenue: 5.38 },
      { model: "claude-sonnet-4", requests: 142, tokens: 786400, revenue: 18.88 },
      { model: "gemini-2.5-pro", requests: 66, tokens: 341900, revenue: 6.87 },
      { model: "deepseek-v3", requests: 60, tokens: 214430, revenue: 3.74 },
    ],
  },
  {
    date: dateBefore(0),
    requests: 428,
    tokens: 1962540,
    revenue: 24.63,
    models: [
      { model: "gpt-4o-mini", requests: 214, tokens: 1002800, revenue: 4.03 },
      { model: "claude-sonnet-4", requests: 108, tokens: 592700, revenue: 14.22 },
      { model: "gemini-2.5-pro", requests: 44, tokens: 218400, revenue: 4.39 },
      { model: "deepseek-v3", requests: 62, tokens: 148640, revenue: 1.99 },
    ],
  },
];

/** 一天里出现过的所有模型，顺序决定堆叠次序与配色下标 */
export function usageModels(series: UsageDay[] = usageSeries) {
  const seen: string[] = [];
  for (const day of series) {
    for (const slice of day.models ?? []) {
      if (!seen.includes(slice.model)) seen.push(slice.model);
    }
  }
  return seen;
}

/* -------------------------------------------------------------- 余额流水 */

export type TxSource = "recharge" | "adjust" | "usage" | "channel_share" | "subscription";

export type BalanceTransaction = {
  id: number;
  user_id: number;
  /** 正数入账、负数扣款（元） */
  delta: number;
  balance_after: number;
  source: TxSource;
  ref_id?: string;
  /** usage / channel_share 关联的计费记录摘要 */
  model?: string;
  total_tokens?: number;
  balance_part?: number;
  credit_part?: number;
  /** 扣的是订阅额度还是余额 */
  ledger?: "quota" | "balance";
  /** 调账、充值这类流水的一句话说明 */
  detail?: string;
  created_at: string;
};

export const balanceTransactions: BalanceTransaction[] = [
  {
    id: 9043,
    user_id: 263,
    delta: -0.42,
    balance_after: 428.65,
    source: "usage",
    ref_id: "req_9f3c1a",
    model: "gpt-4o",
    total_tokens: 18420,
    ledger: "quota",
    balance_part: 0,
    credit_part: 0,
    created_at: minutesAgo(38),
  },
  {
    id: 9042,
    user_id: 263,
    delta: -0.28,
    balance_after: 429.07,
    source: "usage",
    ref_id: "req_7d21be",
    model: "claude-sonnet-4",
    total_tokens: 9210,
    ledger: "quota",
    created_at: minutesAgo(59),
  },
  {
    id: 9041,
    user_id: 263,
    delta: -0.06,
    balance_after: 429.35,
    source: "usage",
    ref_id: "req_51ac08",
    model: "gpt-4o-mini",
    total_tokens: 26400,
    ledger: "quota",
    created_at: minutesAgo(92),
  },
  {
    id: 9040,
    user_id: 263,
    delta: -0.09,
    balance_after: 429.41,
    source: "usage",
    ref_id: "req_33e7f1",
    model: "gemini-2.5-flash",
    total_tokens: 41800,
    ledger: "balance",
    balance_part: 0.09,
    created_at: minutesAgo(248),
  },
  {
    id: 9039,
    user_id: 263,
    delta: 12.4,
    balance_after: 429.5,
    source: "channel_share",
    ref_id: "share_20261009",
    detail: "分享渠道分成（2026-10-09）",
    created_at: daysBefore(1, 3, 12),
  },
  {
    id: 9038,
    user_id: 263,
    delta: -18.36,
    balance_after: 417.1,
    source: "usage",
    detail: "2026-10-09 当日消费合计",
    created_at: daysBefore(1, 0, 5),
  },
  {
    id: 9037,
    user_id: 263,
    delta: -0.03,
    balance_after: 435.46,
    source: "usage",
    ref_id: "req_88b4d2",
    model: "deepseek-v3",
    total_tokens: 12600,
    ledger: "balance",
    balance_part: 0.03,
    created_at: daysBefore(1, 9, 4),
  },
  {
    id: 9036,
    user_id: 263,
    delta: 200,
    balance_after: 435.49,
    source: "recharge",
    ref_id: "order_S20261008012",
    detail: "在线充值 ¥200.00",
    created_at: daysBefore(2, 16, 41),
  },
  {
    id: 9035,
    user_id: 263,
    delta: -0.68,
    balance_after: 235.49,
    source: "usage",
    ref_id: "req_1c93aa",
    model: "claude-opus-4",
    total_tokens: 32800,
    ledger: "balance",
    balance_part: 0.68,
    created_at: daysBefore(3, 12, 8),
  },
  {
    id: 9034,
    user_id: 263,
    delta: -128,
    balance_after: 236.17,
    source: "subscription",
    ref_id: "plan_2",
    detail: "订阅「专业版月付」 ¥128.00",
    created_at: daysBefore(9, 10, 2),
  },
  {
    id: 9033,
    user_id: 263,
    delta: 50,
    balance_after: 364.17,
    source: "adjust",
    ref_id: "adj_20261001",
    detail: "客服补偿：10-01 上游抖动",
    created_at: daysBefore(9, 9, 30),
  },
  {
    id: 9032,
    user_id: 263,
    delta: 9.86,
    balance_after: 314.17,
    source: "channel_share",
    ref_id: "share_20260930",
    detail: "分享渠道分成（2026-09-30）",
    created_at: daysBefore(10, 3, 12),
  },
];

/** GET /user/credits 的形状：余额、额度与流水 */
export const panelCredits = {
  balance: panelMe.balance,
  credit_limit: panelMe.credit_limit,
  credit_available: panelMe.credit_available,
  total: balanceTransactions.length,
  transactions: balanceTransactions,
};

/* -------------------------------------------------------------- 我的密钥 */

export type ApiKey = {
  id: number;
  user_id: number;
  name?: string;
  key_prefix: string;
  key_suffix?: string;
  /** 1 = 启用，0 = 停用 */
  status: number;
  model_whitelist?: string[];
  rate_limit_per_min?: number | null;
  expires_at?: string | null;
  last_used_at?: string | null;
  created_at: string;
  updated_at: string;
};

export const apiKeys: ApiKey[] = [
  {
    id: 41,
    user_id: 263,
    name: "生产环境",
    key_prefix: "sk-tmp-9f3c",
    key_suffix: "a41d7e",
    status: 1,
    rate_limit_per_min: 600,
    expires_at: null,
    last_used_at: minutesAgo(3),
    created_at: daysBefore(198, 11, 20),
    updated_at: daysBefore(198, 11, 20),
  },
  {
    id: 42,
    user_id: 263,
    name: "本地开发",
    key_prefix: "sk-tmp-7d21",
    key_suffix: "b8c204",
    status: 1,
    model_whitelist: ["gpt-4o-mini", "deepseek-v3"],
    rate_limit_per_min: 120,
    expires_at: daysBefore(-24, 12, 0),
    last_used_at: minutesAgo(41),
    created_at: daysBefore(96, 9, 5),
    updated_at: daysBefore(30, 15, 42),
  },
  {
    id: 43,
    user_id: 263,
    name: "数据清洗脚本",
    key_prefix: "sk-tmp-51ac",
    key_suffix: "0f7b19",
    status: 1,
    rate_limit_per_min: 60,
    expires_at: daysBefore(-90, 12, 0),
    last_used_at: daysBefore(2, 4, 18),
    created_at: daysBefore(64, 20, 11),
    updated_at: daysBefore(64, 20, 11),
  },
  {
    id: 44,
    user_id: 263,
    name: "临时联调（已停用）",
    key_prefix: "sk-tmp-33e7",
    key_suffix: "c5d832",
    status: 0,
    expires_at: daysBefore(6, 12, 0),
    last_used_at: daysBefore(12, 17, 55),
    created_at: daysBefore(40, 14, 3),
    updated_at: daysBefore(6, 12, 0),
  },
];

/* -------------------------------------------------------------- 模型目录 */

export type CatalogAccount = {
  id: number;
  name: string;
  owner: "user" | "platform";
  weight: number;
  share_rate?: number;
};

export type CatalogChannel = {
  id: number;
  name: string;
  type: string;
  base_url: string;
  source: "official" | "user" | "platform";
  supports: string[];
  user_shared: boolean;
  /** 上游成本（元 / 百万 token）。用户看到的单价 = 成本 × 套餐倍率 */
  cost_input_per_million: number;
  cost_output_per_million: number;
  accounts: CatalogAccount[];
};

export type CatalogModel = {
  model: string;
  channels: CatalogChannel[];
};

/** 目录更新时间，概览和模型页都会显示 */
export const catalogUpdatedAt = minutesAgo(12);

export const catalogModels: CatalogModel[] = [
  {
    model: "gpt-4o",
    channels: [
      {
        id: 1,
        name: "OpenAI 官方直连",
        type: "openai",
        base_url: "https://api.openai.com",
        source: "official",
        supports: ["chat", "responses", "tools"],
        cost_input_per_million: 17.5,
        cost_output_per_million: 70,
        user_shared: false,
        accounts: [
          { id: 11, name: "openai-main", owner: "platform", weight: 10 },
          { id: 12, name: "openai-backup", owner: "platform", weight: 4 },
        ],
      },
      {
        id: 7,
        name: "知远分享的 OpenAI 池",
        type: "openai",
        base_url: "https://api.openai.com",
        source: "user",
        supports: ["chat", "tools"],
        cost_input_per_million: 18.2,
        cost_output_per_million: 72.8,
        user_shared: true,
        accounts: [{ id: 21, name: "linzy-openai-1", owner: "user", weight: 6, share_rate: 0.12 }],
      },
    ],
  },
  {
    model: "gpt-4o-mini",
    channels: [
      {
        id: 1,
        name: "OpenAI 官方直连",
        type: "openai",
        base_url: "https://api.openai.com",
        source: "official",
        supports: ["chat", "responses", "tools"],
        cost_input_per_million: 17.5,
        cost_output_per_million: 70,
        user_shared: false,
        accounts: [{ id: 11, name: "openai-main", owner: "platform", weight: 10 }],
      },
      {
        id: 9,
        name: "OpenAI 备用（美国节点）",
        type: "openai",
        base_url: "https://us.api.example.com",
        source: "platform",
        supports: ["chat"],
        cost_input_per_million: 1.05,
        cost_output_per_million: 4.2,
        user_shared: false,
        accounts: [{ id: 31, name: "openai-us-1", owner: "platform", weight: 5 }],
      },
    ],
  },
  {
    model: "claude-sonnet-4",
    channels: [
      {
        id: 2,
        name: "Anthropic 官方直连",
        type: "anthropic",
        base_url: "https://api.anthropic.com",
        source: "official",
        supports: ["messages", "tools", "cache"],
        cost_input_per_million: 21.0,
        cost_output_per_million: 105,
        user_shared: false,
        accounts: [
          { id: 13, name: "anthropic-main", owner: "platform", weight: 10 },
          { id: 14, name: "anthropic-eu", owner: "platform", weight: 3 },
        ],
      },
      {
        id: 8,
        name: "企业池（用户分享）",
        type: "anthropic",
        base_url: "https://api.anthropic.com",
        source: "user",
        supports: ["messages", "cache"],
        cost_input_per_million: 21.7,
        cost_output_per_million: 108.5,
        user_shared: true,
        accounts: [
          { id: 22, name: "chenmo-claude-1", owner: "user", weight: 8, share_rate: 0.1 },
          { id: 23, name: "chenmo-claude-2", owner: "user", weight: 4, share_rate: 0.1 },
        ],
      },
    ],
  },
  {
    model: "claude-opus-4",
    channels: [
      {
        id: 2,
        name: "Anthropic 官方直连",
        type: "anthropic",
        base_url: "https://api.anthropic.com",
        source: "official",
        supports: ["messages", "tools", "cache"],
        cost_input_per_million: 21.0,
        cost_output_per_million: 105,
        user_shared: false,
        accounts: [{ id: 13, name: "anthropic-main", owner: "platform", weight: 10 }],
      },
    ],
  },
  {
    model: "claude-haiku-4",
    channels: [
      {
        id: 2,
        name: "Anthropic 官方直连",
        type: "anthropic",
        base_url: "https://api.anthropic.com",
        source: "official",
        supports: ["messages", "cache"],
        cost_input_per_million: 21.0,
        cost_output_per_million: 105,
        user_shared: false,
        accounts: [{ id: 14, name: "anthropic-eu", owner: "platform", weight: 6 }],
      },
    ],
  },
  {
    model: "gemini-2.5-pro",
    channels: [
      {
        id: 3,
        name: "Google 官方直连",
        type: "openai",
        base_url: "https://generativelanguage.googleapis.com",
        source: "official",
        supports: ["chat", "tools", "vision"],
        cost_input_per_million: 8.75,
        cost_output_per_million: 35,
        user_shared: false,
        accounts: [{ id: 15, name: "google-main", owner: "platform", weight: 10 }],
      },
    ],
  },
  {
    model: "gemini-2.5-flash",
    channels: [
      {
        id: 3,
        name: "Google 官方直连",
        type: "openai",
        base_url: "https://generativelanguage.googleapis.com",
        source: "official",
        supports: ["chat", "vision"],
        cost_input_per_million: 8.75,
        cost_output_per_million: 35,
        user_shared: false,
        accounts: [{ id: 15, name: "google-main", owner: "platform", weight: 10 }],
      },
    ],
  },
  {
    model: "deepseek-v3",
    channels: [
      {
        id: 4,
        name: "DeepSeek 官方直连",
        type: "openai",
        base_url: "https://api.deepseek.com",
        source: "official",
        supports: ["chat", "tools"],
        cost_input_per_million: 1.4,
        cost_output_per_million: 5.6,
        user_shared: false,
        accounts: [
          { id: 16, name: "deepseek-main", owner: "platform", weight: 10 },
          { id: 17, name: "deepseek-burst", owner: "platform", weight: 2 },
        ],
      },
    ],
  },
  {
    model: "deepseek-r1",
    channels: [
      {
        id: 4,
        name: "DeepSeek 官方直连",
        type: "openai",
        base_url: "https://api.deepseek.com",
        source: "official",
        supports: ["chat", "reasoning"],
        cost_input_per_million: 1.4,
        cost_output_per_million: 5.6,
        user_shared: false,
        accounts: [{ id: 16, name: "deepseek-main", owner: "platform", weight: 10 }],
      },
    ],
  },
  {
    model: "qwen3-max",
    channels: [
      {
        id: 5,
        name: "通义千问（阿里云）",
        type: "openai",
        base_url: "https://dashscope.aliyuncs.com",
        source: "platform",
        supports: ["chat", "tools"],
        cost_input_per_million: 1.68,
        cost_output_per_million: 6.72,
        user_shared: false,
        accounts: [{ id: 18, name: "qwen-main", owner: "platform", weight: 8 }],
      },
    ],
  },
  {
    model: "grok-4",
    channels: [
      {
        id: 6,
        name: "xAI 官方直连",
        type: "openai",
        base_url: "https://api.x.ai",
        source: "official",
        supports: ["chat", "tools"],
        cost_input_per_million: 21.0,
        cost_output_per_million: 105,
        user_shared: false,
        accounts: [{ id: 19, name: "xai-main", owner: "platform", weight: 8 }],
      },
    ],
  },
];

/** GET /user/auto-chain：没配过是空数组，不是 404 */
export const autoChain: string[] = ["gpt-4o", "claude-sonnet-4", "deepseek-v3", "gpt-4o-mini"];

/* ------------------------------------------------------------------ 套餐 */

export type PlanView = {
  id: number;
  name: string;
  mode: "subscription" | "pay_as_you_go";
  /** subscription：额度单位是金额还是点数 */
  quota_kind: "money" | "requests";
  pricing_mode: "markup" | "table";
  markup_multiplier?: number | null;
  /** 展示牌价；null = 面议 */
  price?: number | null;
  quota_amount?: number | null;
  quota_period_days?: number | null;
  overage_mode: "disabled" | "bill";
  currency: string;
  model_count: number;
  weight_min?: number | null;
  weight_max?: number | null;
  updated_at: string;
};

export type CurrentPlan = {
  plan: PlanView;
  quota_limit: number;
  quota_used: number;
  period_start?: string | null;
  period_end?: string | null;
};

export const planViews: PlanView[] = [
  {
    id: 1,
    name: "标准版月付",
    mode: "subscription",
    quota_kind: "money",
    pricing_mode: "markup",
    markup_multiplier: 1.15,
    price: 68,
    quota_amount: 68,
    quota_period_days: 30,
    overage_mode: "bill",
    currency: "CNY",
    model_count: 11,
    updated_at: daysBefore(21, 10, 0),
  },
  {
    id: 2,
    name: "专业版月付",
    mode: "subscription",
    quota_kind: "money",
    pricing_mode: "markup",
    markup_multiplier: 1.1,
    price: 128,
    quota_amount: 128,
    quota_period_days: 30,
    overage_mode: "bill",
    currency: "CNY",
    model_count: 11,
    updated_at: daysBefore(21, 10, 0),
  },
  {
    id: 3,
    name: "企业版年付",
    mode: "subscription",
    quota_kind: "money",
    pricing_mode: "table",
    price: 12800,
    quota_amount: 12800,
    quota_period_days: 365,
    overage_mode: "bill",
    currency: "CNY",
    model_count: 11,
    updated_at: daysBefore(21, 10, 0),
  },
  {
    id: 4,
    name: "按量付费",
    mode: "pay_as_you_go",
    quota_kind: "money",
    pricing_mode: "table",
    price: null,
    quota_amount: null,
    quota_period_days: null,
    overage_mode: "bill",
    currency: "CNY",
    model_count: 11,
    updated_at: daysBefore(21, 10, 0),
  },
  {
    id: 5,
    name: "轻量点数包",
    mode: "subscription",
    quota_kind: "requests",
    pricing_mode: "table",
    price: 39,
    quota_amount: 20000,
    quota_period_days: 30,
    overage_mode: "disabled",
    currency: "CNY",
    model_count: 6,
    weight_min: 0.5,
    weight_max: 1.5,
    updated_at: daysBefore(21, 10, 0),
  },
];

/** 当前订阅：专业版月付，周期内已用一部分额度 */
export const currentPlan: CurrentPlan = {
  plan: planViews[1],
  quota_limit: 128,
  quota_used: 74.62,
  period_start: daysBefore(11, 10, 2),
  period_end: daysBefore(-19, 10, 2),
};

/* -------------------------------------------------------------- 请求日志 */

export type RequestRecord = {
  request_id: string;
  user_id: number;
  api_key_id: number;
  model: string;
  served_model?: string | null;
  /** chat | messages | responses | embeddings */
  entry: string;
  stream: boolean;
  channel: string;
  channel_type: string;
  base_url?: string | null;
  status: string;
  http_status?: number | null;
  error_code?: string | null;
  error_message?: string | null;
  panel_message?: string | null;
  upstream_code?: string | null;
  attempts: number;
  retried: boolean;
  user_agent?: string | null;
  reasoning_effort?: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  latency_ms?: number | null;
  ttfb_ms?: number | null;
  tps?: number | null;
  created_at: string;
};

/** 造一条请求记录：只写要变的那几个字段，其余按同一套规律推 */
function requestRecord(
  index: number,
  input: {
    model: string;
    channel: string;
    channel_type: string;
    status: "success" | "error" | "in_progress";
    minutes: number;
    prompt: number;
    completion: number;
    apiKeyId?: number;
    entry?: string;
    stream?: boolean;
    error?: { code: string; panel: string; upstream?: string };
    retried?: boolean;
    cacheRead?: number;
  },
): RequestRecord {
  const total = input.prompt + input.completion;
  // 缓存读取按 prompt 的一成估，成功率高的推理模型给得更低
  const cacheRead = input.cacheRead ?? Math.round(input.prompt * 0.12);
  return {
    request_id: `req_${(0x9f3c1a + index * 0x2f41).toString(16).slice(0, 6)}`,
    user_id: 263,
    api_key_id: input.apiKeyId ?? 41,
    model: input.model,
    served_model: null,
    entry: input.entry ?? "chat",
    stream: input.stream ?? true,
    channel: input.channel,
    channel_type: input.channel_type,
    base_url: null,
    status: input.status,
    http_status: input.status === "error" ? 502 : input.status === "in_progress" ? null : 200,
    error_code: input.error?.code ?? null,
    error_message: input.error?.upstream ?? null,
    panel_message: input.error?.panel ?? null,
    upstream_code: input.error?.upstream ? "upstream_error" : null,
    attempts: input.retried ? 2 : 1,
    retried: Boolean(input.retried),
    user_agent: "openai-python/1.54.3",
    reasoning_effort: null,
    prompt_tokens: input.prompt,
    completion_tokens: input.completion,
    cache_read_tokens: cacheRead,
    cache_write_tokens: 0,
    total_tokens: total,
    latency_ms: input.status === "in_progress" ? null : 620 + ((index * 173) % 2400),
    ttfb_ms: input.status === "in_progress" ? null : 180 + ((index * 91) % 620),
    tps: input.completion > 0 ? Number((input.completion / (0.8 + (index % 5) * 0.4)).toFixed(1)) : null,
    created_at: minutesAgo(input.minutes),
  };
}

export const requestRecords: RequestRecord[] = [
  requestRecord(0, { model: "gpt-4o", channel: "OpenAI 官方直连", channel_type: "openai", status: "success", minutes: 3, prompt: 14820, completion: 3600 }),
  requestRecord(1, { model: "claude-sonnet-4", channel: "Anthropic 官方直连", channel_type: "anthropic", status: "success", minutes: 9, prompt: 6240, completion: 2970, cacheRead: 4820 }),
  requestRecord(2, { model: "gpt-4o-mini", channel: "OpenAI 官方直连", channel_type: "openai", status: "success", minutes: 14, prompt: 22100, completion: 4300, apiKeyId: 43 }),
  requestRecord(3, { model: "deepseek-v3", channel: "DeepSeek 官方直连", channel_type: "openai", status: "error", minutes: 26, prompt: 9100, completion: 0, retried: true, error: { code: "upstream_timeout", panel: "上游响应超时，已自动重试一次仍失败", upstream: "Upstream request timeout after 30s" } }),
  requestRecord(4, { model: "gemini-2.5-pro", channel: "Google 官方直连", channel_type: "openai", status: "success", minutes: 33, prompt: 18200, completion: 4200, stream: false }),
  requestRecord(5, { model: "claude-sonnet-4", channel: "企业池（用户分享）", channel_type: "anthropic", status: "success", minutes: 47, prompt: 11400, completion: 6800, stream: false, entry: "messages" }),
  requestRecord(6, { model: "gpt-4o-mini", channel: "OpenAI 备用（美国节点）", channel_type: "openai", status: "in_progress", minutes: 52, prompt: 5400, completion: 0 }),
  requestRecord(7, { model: "deepseek-r1", channel: "DeepSeek 官方直连", channel_type: "openai", status: "success", minutes: 68, prompt: 7400, completion: 18900 }),
  requestRecord(8, { model: "qwen3-max", channel: "通义千问（阿里云）", channel_type: "openai", status: "success", minutes: 84, prompt: 12800, completion: 3100, apiKeyId: 42 }),
  requestRecord(9, { model: "gpt-4o", channel: "OpenAI 官方直连", channel_type: "openai", status: "success", minutes: 96, prompt: 26400, completion: 7800, retried: true }),
  requestRecord(10, { model: "claude-haiku-4", channel: "Anthropic 官方直连", channel_type: "anthropic", status: "success", minutes: 118, prompt: 4600, completion: 1800, entry: "messages" }),
  requestRecord(11, { model: "gemini-2.5-flash", channel: "Google 官方直连", channel_type: "openai", status: "success", minutes: 141, prompt: 38600, completion: 3200 }),
  requestRecord(12, { model: "grok-4", channel: "xAI 官方直连", channel_type: "openai", status: "error", minutes: 165, prompt: 6800, completion: 0, error: { code: "upstream_rate_limited", panel: "上游限流，请稍后重试", upstream: "429 Too Many Requests" } }),
  requestRecord(13, { model: "deepseek-v3", channel: "DeepSeek 官方直连", channel_type: "openai", status: "success", minutes: 188, prompt: 47300, completion: 6200, apiKeyId: 42 }),
  requestRecord(14, { model: "gpt-4o-mini", channel: "OpenAI 官方直连", channel_type: "openai", status: "success", minutes: 212, prompt: 15800, completion: 2600, apiKeyId: 43 }),
  requestRecord(15, { model: "claude-sonnet-4", channel: "Anthropic 官方直连", channel_type: "anthropic", status: "success", minutes: 246, prompt: 33600, completion: 12400, cacheRead: 24100 }),
  requestRecord(16, { model: "gpt-4o", channel: "知远分享的 OpenAI 池", channel_type: "openai", status: "success", minutes: 288, prompt: 18600, completion: 4100, apiKeyId: 42 }),
  requestRecord(17, { model: "deepseek-r1", channel: "DeepSeek 官方直连", channel_type: "openai", status: "success", minutes: 331, prompt: 9200, completion: 22600 }),
  requestRecord(18, { model: "qwen3-max", channel: "通义千问（阿里云）", channel_type: "openai", status: "error", minutes: 375, prompt: 4200, completion: 0, error: { code: "channel_unavailable", panel: "该渠道暂时不可用，已切换到备用渠道", upstream: "503 Service Unavailable" } }),
  requestRecord(19, { model: "gemini-2.5-pro", channel: "Google 官方直连", channel_type: "openai", status: "success", minutes: 418, prompt: 21400, completion: 5600 }),
  requestRecord(20, { model: "claude-opus-4", channel: "Anthropic 官方直连", channel_type: "anthropic", status: "success", minutes: 462, prompt: 27600, completion: 5200, entry: "messages", stream: false }),
  requestRecord(21, { model: "gpt-4o-mini", channel: "OpenAI 官方直连", channel_type: "openai", status: "success", minutes: 505, prompt: 64800, completion: 12800, apiKeyId: 43 }),
  requestRecord(22, { model: "deepseek-v3", channel: "DeepSeek 官方直连", channel_type: "openai", status: "success", minutes: 549, prompt: 158200, completion: 21400, retried: true }),
  requestRecord(23, { model: "claude-sonnet-4", channel: "企业池（用户分享）", channel_type: "anthropic", status: "success", minutes: 592, prompt: 43800, completion: 16200, entry: "messages", stream: false }),
];

/* -------------------------------------------------------------- 账单流水 */

export type BillingRecord = {
  id: number;
  request_id: string;
  user_id: number;
  api_key_id: number;
  channel_name: string;
  model: string;
  entry: string;
  stream: boolean;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  cost_multiplier: number;
  revenue_multiplier: number;
  /** 平台成本（元） */
  cost_amount: number;
  /** 用户实付（元） */
  revenue_amount: number;
  /** 上游账号属主拿到的分成（元） */
  owner_credit_amount: number;
  billing_mode: string;
  /** quota = 扣订阅额度，balance = 扣余额 */
  ledger: "quota" | "balance";
  latency_ms?: number | null;
  status: string;
  credit_paid?: number;
  balance_paid?: number;
  created_at: string;
};

/** 录一条账单：实付 = 成本 × 加价倍率，差价就是平台毛利 */
const billingRecord = (
  index: number,
  record: RequestRecord,
  input: { cost: number; markup: number; ledger: "quota" | "balance"; ownerCredit?: number; variance?: number },
): BillingRecord => {
  const revenue = Number((input.cost * input.markup).toFixed(4));
  return {
    id: 7000 - index,
    request_id: record.request_id,
    user_id: 263,
    api_key_id: record.api_key_id,
    channel_name: record.channel,
    model: record.model,
    entry: record.entry,
    stream: record.stream,
    prompt_tokens: record.prompt_tokens,
    completion_tokens: record.completion_tokens,
    cache_read_tokens: record.cache_read_tokens,
    cache_write_tokens: record.cache_write_tokens,
    total_tokens: record.total_tokens,
    cost_multiplier: 1,
    revenue_multiplier: input.markup,
    cost_amount: input.cost,
    // variance 用来演示「账面金额与流水对不上」的个别条目（对账页用得上）
    revenue_amount: input.variance ?? revenue,
    owner_credit_amount: input.ownerCredit ?? 0,
    billing_mode: "subscription",
    ledger: input.ledger,
    latency_ms: record.latency_ms ?? null,
    status: record.status,
    credit_paid: input.ledger === "balance" ? 0 : undefined,
    balance_paid: input.ledger === "balance" ? revenue : undefined,
    created_at: record.created_at,
  };
};

export const billingRecords: BillingRecord[] = [
  billingRecord(0, requestRecords[0], { cost: 0.38, markup: 1.1, ledger: "quota" }),
  billingRecord(1, requestRecords[1], { cost: 0.25, markup: 1.1, ledger: "quota" }),
  billingRecord(2, requestRecords[2], { cost: 0.055, markup: 1.1, ledger: "quota" }),
  // 失败的请求不计费：成本与实付都是 0，详情里也标「未计费」
  billingRecord(3, requestRecords[3], { cost: 0, markup: 1, ledger: "quota" }),
  billingRecord(4, requestRecords[4], { cost: 0.28, markup: 1.1, ledger: "quota" }),
  billingRecord(5, requestRecords[5], { cost: 0.4, markup: 1.1, ledger: "quota", ownerCredit: 0.048 }),
  billingRecord(6, requestRecords[7], { cost: 0.14, markup: 1.1, ledger: "quota" }),
  billingRecord(7, requestRecords[8], { cost: 0.088, markup: 1.1, ledger: "quota" }),
  billingRecord(8, requestRecords[9], { cost: 0.62, markup: 1.1, ledger: "quota" }),
  billingRecord(9, requestRecords[10], { cost: 0.045, markup: 1.1, ledger: "quota" }),
  billingRecord(10, requestRecords[11], { cost: 0.079, markup: 1.1, ledger: "quota" }),
  billingRecord(11, recordWith({ minutes: 302, model: "gpt-4o", prompt: 21400, completion: 5200 }), { cost: 0.44, markup: 1.1, ledger: "balance" }),
  billingRecord(12, requestRecords[13], { cost: 0.11, markup: 1.1, ledger: "balance" }),
  billingRecord(13, requestRecords[14], { cost: 0.04, markup: 1.1, ledger: "balance" }),
  billingRecord(14, requestRecords[15], { cost: 1.32, markup: 1.1, ledger: "balance", ownerCredit: 0.13 }),
  billingRecord(15, requestRecords[16], { cost: 0.39, markup: 1.1, ledger: "balance", ownerCredit: 0.047 }),
  billingRecord(16, requestRecords[17], { cost: 0.17, markup: 1.1, ledger: "balance" }),
  billingRecord(17, requestRecords[19], { cost: 0.3, markup: 1.1, ledger: "balance" }),
  billingRecord(18, requestRecords[20], { cost: 0.88, markup: 1.1, ledger: "balance" }),
  billingRecord(19, requestRecords[21], { cost: 0.14, markup: 1.1, ledger: "balance" }),
  billingRecord(20, requestRecords[22], { cost: 0.33, markup: 1.1, ledger: "balance" }),
  billingRecord(21, requestRecords[23], { cost: 1.62, markup: 1.1, ledger: "balance", ownerCredit: 0.16 }),
];

/** 账单里补几条请求日志没列全的记录，凑够分页的样子 */
function recordWith(input: { minutes: number; model: string; prompt: number; completion: number }): RequestRecord {
  return requestRecord(90 + input.minutes, {
    model: input.model,
    channel: "OpenAI 官方直连",
    channel_type: "openai",
    status: "success",
    minutes: input.minutes,
    prompt: input.prompt,
    completion: input.completion,
  });
}

/* ------------------------------------------------------------ 分享的账号 */

export type SharedAccount = {
  id: number;
  group_id: number;
  group_name?: string;
  name: string;
  channel_name: string;
  weight: number;
  cost_multiplier?: number | null;
  owner_user_id: number | null;
  share_rate?: number | null;
  /** 分享账号可见性：false = 仅自己可调用 */
  public?: boolean;
  share_state?: "private" | "pending" | "public";
  probe_models?: string | null;
  probe_at?: string | null;
  disabled: number;
  created_at: string;
  updated_at: string;
};

export const sharedAccounts: SharedAccount[] = [
  {
    id: 21,
    group_id: 7,
    group_name: "知远分享的 OpenAI 池",
    name: "linzy-openai-1",
    channel_name: "知远分享的 OpenAI 池__linzy-openai-1",
    weight: 6,
    cost_multiplier: 1,
    owner_user_id: 263,
    share_rate: 0.12,
    public: true,
    share_state: "public",
    probe_models: "gpt-4o,gpt-4o-mini,gpt-4.1",
    probe_at: daysBefore(4, 11, 26),
    disabled: 0,
    created_at: daysBefore(38, 15, 12),
    updated_at: daysBefore(4, 11, 26),
  },
  {
    id: 22,
    group_id: 8,
    group_name: "企业池（用户分享）",
    name: "chenmo-claude-1",
    channel_name: "企业池（用户分享）__chenmo-claude-1",
    weight: 8,
    cost_multiplier: 1,
    owner_user_id: 263,
    share_rate: 0.1,
    public: true,
    share_state: "public",
    probe_models: "claude-sonnet-4,claude-opus-4",
    probe_at: daysBefore(9, 9, 41),
    disabled: 0,
    created_at: daysBefore(52, 10, 8),
    updated_at: daysBefore(9, 9, 41),
  },
  {
    id: 23,
    group_id: 8,
    group_name: "企业池（用户分享）",
    name: "chenmo-claude-2",
    channel_name: "企业池（用户分享）__chenmo-claude-2",
    weight: 4,
    cost_multiplier: 1.05,
    owner_user_id: 263,
    share_rate: 0.1,
    public: false,
    share_state: "private",
    probe_models: "claude-sonnet-4",
    probe_at: daysBefore(2, 20, 15),
    disabled: 0,
    created_at: daysBefore(19, 13, 2),
    updated_at: daysBefore(2, 20, 15),
  },
  {
    id: 24,
    group_id: 7,
    group_name: "知远分享的 OpenAI 池",
    name: "linzy-openai-2",
    channel_name: "知远分享的 OpenAI 池__linzy-openai-2",
    weight: 3,
    cost_multiplier: 1,
    owner_user_id: 263,
    share_rate: 0.12,
    public: false,
    share_state: "pending",
    probe_models: null,
    probe_at: null,
    disabled: 0,
    created_at: daysBefore(1, 18, 30),
    updated_at: daysBefore(1, 18, 30),
  },
];

/* ------------------------------------------------------------ 渠道与申请 */

export type AccountGroup = {
  id: number;
  name: string;
  type: string;
  base_url: string;
  models: string[];
  owned_by_me: boolean;
  account_count: number;
  share_rate?: number | null;
};

export const accountGroups: AccountGroup[] = [
  {
    id: 7,
    name: "知远分享的 OpenAI 池",
    type: "openai",
    base_url: "https://api.openai.com",
    models: ["gpt-4o", "gpt-4o-mini"],
    owned_by_me: true,
    account_count: 2,
    share_rate: 0.12,
  },
  {
    id: 8,
    name: "企业池（用户分享）",
    type: "anthropic",
    base_url: "https://api.anthropic.com",
    models: ["claude-sonnet-4", "claude-opus-4"],
    owned_by_me: true,
    account_count: 2,
    share_rate: 0.1,
  },
  {
    id: 1,
    name: "OpenAI 官方直连",
    type: "openai",
    base_url: "https://api.openai.com",
    models: ["gpt-4o", "gpt-4o-mini"],
    owned_by_me: false,
    account_count: 2,
  },
  {
    id: 4,
    name: "DeepSeek 官方直连",
    type: "openai",
    base_url: "https://api.deepseek.com",
    models: ["deepseek-v3", "deepseek-r1"],
    owned_by_me: false,
    account_count: 2,
  },
  {
    id: 5,
    name: "通义千问（阿里云）",
    type: "openai",
    base_url: "https://dashscope.aliyuncs.com",
    models: ["qwen3-max"],
    owned_by_me: false,
    account_count: 1,
  },
];

export type ChannelApplication = {
  id: number;
  applicant_user_id: number;
  name: string;
  type: string;
  base_url: string;
  models: string[];
  share_rate?: number | null;
  status: "pending" | "approved" | "rejected";
  admin_note?: string;
  reviewed_at?: string | null;
  created_at: string;
};

export const channelApplications: ChannelApplication[] = [
  {
    id: 31,
    applicant_user_id: 263,
    name: "自建 Azure OpenAI",
    type: "openai",
    base_url: "https://tokenmp-eastus.openai.azure.com",
    models: ["gpt-4o", "gpt-4o-mini"],
    share_rate: 0.1,
    status: "pending",
    created_at: daysBefore(2, 21, 14),
  },
  {
    id: 30,
    applicant_user_id: 263,
    name: "企业池（用户分享）",
    type: "anthropic",
    base_url: "https://api.anthropic.com",
    models: ["claude-sonnet-4", "claude-opus-4"],
    share_rate: 0.1,
    status: "approved",
    admin_note: "已核验模型清单，分成按 10% 结算",
    reviewed_at: daysBefore(52, 11, 30),
    created_at: daysBefore(53, 16, 42),
  },
  {
    id: 29,
    applicant_user_id: 263,
    name: "自建 Gemini 中转",
    type: "openai",
    base_url: "https://gemini-proxy.example.com",
    models: ["gemini-2.5-pro"],
    status: "rejected",
    admin_note: "上游凭据探测未通过，请确认 base_url 与 api_key 后重新提交",
    reviewed_at: daysBefore(40, 9, 5),
    created_at: daysBefore(41, 20, 8),
  },
];

/* ------------------------------------------------------------ 账号用量 */

export type AccountUsageRecord = {
  request_id: string;
  model: string;
  status: string;
  prompt_tokens: number;
  completion_tokens: number;
  revenue_amount: number;
  owner_credit_amount: number;
  self_owned: boolean;
  created_at: string;
};

export type AccountUsage = {
  account_id: number;
  account_name: string;
  channel_name: string;
  total: number;
  requests: number;
  credit: number;
  records: AccountUsageRecord[];
};

/**
 * 分享账号被调用了多少。
 *
 * 走我这个账号的调用会出现在账单里：别人用的时候带 owner_credit_amount（我拿到的分成），
 * 我自己用的时候没有。按账号所在的渠道组取模型家族（组 7 是 OpenAI，其余是 Anthropic）。
 */
export function accountUsage(account: SharedAccount): AccountUsage {
  const family = account.group_id === 7 ? "gpt" : "claude";
  const records: AccountUsageRecord[] = billingRecords
    .filter(record => record.model.startsWith(family))
    .slice(0, 6)
    .map(record => ({
      request_id: record.request_id,
      model: record.model,
      status: record.status,
      prompt_tokens: record.prompt_tokens,
      completion_tokens: record.completion_tokens,
      revenue_amount: record.revenue_amount,
      owner_credit_amount: record.owner_credit_amount,
      self_owned: record.owner_credit_amount === 0,
      created_at: record.created_at,
    }));

  return {
    account_id: account.id,
    account_name: account.name,
    channel_name: account.channel_name,
    total: records.length,
    requests: records.length,
    credit: Number(records.reduce((sum, r) => sum + r.owner_credit_amount, 0).toFixed(4)),
    records,
  };
}
