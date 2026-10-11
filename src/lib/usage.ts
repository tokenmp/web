/**
 * 用量、请求记录、账单与控制台概览的客户端数据层。
 *
 * 字段名与 openapi.yaml 对齐（snake_case），与后端一对一。
 * 走 src/lib/api-client.ts 的统一信封解包：列表端点拿 { items, total }，
 * 单对象端点的 total 放在 items 那一层照旧。
 *
 * 数据来自转发内核回写的记录；内核还没接之前，这些接口会返回空列表而不是报错，
 * 页面用空状态撑住即可。
 */

import { getData, getList, query } from "./api-client";

export type RecordFilters = {
  models: string[];
  user_agents: string[];
};

export type RequestRecord = {
  request_id: string;
  user_id: number | null;
  api_key_id: number | null;
  model: string | null;
  served_model: string | null;
  entry: string | null;
  stream: boolean;
  channel: string | null;
  channel_type: string | null;
  base_url: string | null;
  status: string;
  http_status: number | null;
  error_message: string | null;
  error_code: string | null;
  render_status: number | null;
  upstream_code: string | null;
  upstream_message: string | null;
  panel_message: string | null;
  attempts: number | null;
  retried: boolean | null;
  user_agent: string | null;
  reasoning_effort: string | null;
  latency_ms: number | null;
  ttfb_ms: number | null;
  tps: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type BillingRecord = {
  id: number;
  request_id: string;
  user_id: number | null;
  api_key_id: number | null;
  plan_id: number | null;
  channel_id: number | null;
  channel_name: string | null;
  owner_user_id: number | null;
  entry: string | null;
  model: string | null;
  stream: boolean;
  usage_source: string | null;
  charge_mode: string | null;
  cost_multiplier: number;
  cost_amount: number;
  revenue_multiplier: number;
  revenue_amount: number;
  owner_credit_amount: number;
  currency: string;
  billing_mode: string | null;
  ledger: string | null;
  latency_ms: number | null;
  http_status: number | null;
  attempts: number | null;
  retried: boolean | null;
  status: string;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  created_at: string;
  /** 只有 /user/billing_records 会带 */
  credit_paid?: number;
  balance_paid?: number;
};

export type UsageModelSlice = {
  model: string;
  requests: number;
  tokens: number;
  revenue: number;
};

export type UsageSeriesItem = {
  date: string;
  requests: number;
  tokens: number;
  revenue: number;
  models: UsageModelSlice[];
};

export type DashboardUsageItem = {
  day: string;
  requests: number;
  revenue: number;
};

export type DashboardSummary = {
  last_24h: {
    requests: number;
    success: number;
    success_rate: number;
    cost: number;
    revenue: number;
  };
  low_balance_users: number;
};

export type ListParams = {
  page?: number;
  size?: number;
};

/* --------------------------------------------------------------- 用户面板 */

/** 我的用量趋势，按天升序 */
export async function getUsage(days = 30): Promise<UsageSeriesItem[]> {
  const data = await getData<{ series: UsageSeriesItem[] }>(
    `/api/user/usage${query({ days })}`,
  );
  return data.series;
}

/** 我的调用记录 */
export function getRequestRecords(
  params: ListParams & {
    keyword?: string;
    model?: string;
    user_agent?: string;
    /** 本机扩展，openapi 的 /user/request_records 没有这个参数 */
    status?: string;
    error_code?: string;
    start?: string;
    end?: string;
  },
) {
  return getList<RequestRecord>(`/api/user/request-records${query(params)}`);
}

/** 我的调用记录里出现过的模型与 user agent */
export function getRequestRecordFilters() {
  return getData<RecordFilters>("/api/user/request-records/filters");
}

/** 我的账单 */
export function getBillingRecords(
  params: ListParams & {
    model?: string;
    request_id?: string;
    status?: string;
    charge?: "free" | "paid";
    start?: string;
    end?: string;
  },
) {
  return getList<BillingRecord>(`/api/user/billing-records${query(params)}`);
}

/* --------------------------------------------------------------- 控制台 */

/** 概览指标，固定最近 24 小时 */
export function getDashboardSummary() {
  return getData<DashboardSummary>("/api/admin/dashboard/summary");
}

/** 按天的用量趋势，days 超出 1 到 90 由服务端回落到 7 */
export function getDashboardUsage(days = 7) {
  return getList<DashboardUsageItem>(`/api/admin/dashboard/usage${query({ days })}`);
}

/** 全站计费流水 */
export function getAdminBillingRecords(
  params: ListParams & {
    user_id?: number;
    api_key_id?: number;
    model?: string;
    channel_name?: string;
    status?: string;
    start?: string;
    end?: string;
    sort?: string;
    order?: "asc" | "desc";
  },
) {
  return getList<BillingRecord>(`/api/admin/billing-records${query(params)}`);
}

/** 全站调用记录 */
export function getAdminRequestRecords(
  params: ListParams & {
    user_id?: number;
    keyword?: string;
    model?: string;
    user_agent?: string;
    status?: string;
    error_code?: string;
    start?: string;
    end?: string;
    sort?: string;
    order?: "asc" | "desc";
  },
) {
  return getList<RequestRecord>(`/api/admin/request-records${query(params)}`);
}

/** 全站调用记录里出现过的模型与 user agent */
export function getAdminRequestRecordFilters() {
  return getData<RecordFilters>("/api/admin/request-records/filters");
}
