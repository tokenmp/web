/**
 * 控制台「用户管理」页的客户端数据层。
 *
 * 后端端点（全部 x-implemented: local）：
 *   GET    /api/admin/users                   列表，支持 page/size/keyword/status/sort/order
 *   POST   /api/admin/users                   新建
 *   GET    /api/admin/users/{id}              详情（含预算与订阅快照）
 *   PUT    /api/admin/users/{id}              改（任意子集，plan_id: null 表示解绑）
 *   DELETE /api/admin/users/{id}              禁用（软删，status=0）
 *   PUT    /api/admin/users/{id}/budget       设预算
 *   GET    /api/admin/users/{id}/api_keys     某用户的密钥
 *   POST   /api/admin/users/{id}/api_keys     签发密钥，明文只在这一条响应里
 *   DELETE /api/admin/api_keys/{id}           吊销密钥（硬删）
 *
 * 字段名与 openapi.yaml 一致（snake_case）。请求都同源，会话 cookie 由浏览器带。
 * 组织方式参照 src/lib/system.ts：这里只管收发，展示口径（标签、掩码）也收在一起，
 * 页面不必再各写一套。
 */

import { deleteOk, getData, getList, postData, putData, putOk, query } from "./api-client";

/* ------------------------------------------------------------------ 类型 */

/** User 的核字段。POST/PUT 回的就是这个，没有 balance/budget/subscription */
export type AdminUser = {
  id: number;
  name: string;
  email: string | null;
  role: string;
  /** 1 正常，0 停用 */
  status: number;
  credit_limit: number;
  plan_id: number | null;
  token_version: number;
  /** 本机独有：这条用户是从哪套线上表导入的 */
  source: string;
  created_at: string | null;
  updated_at: string | null;
};

export type UserBudget = {
  user_id: number;
  /** 1 启用、0 关闭。enabled=0 或 amount=0 都表示没设预算 */
  enabled: number;
  amount: number;
  period: string;
  period_start: string | null;
  period_end: string | null;
  /** 本周期已用掉的量，网关累计出来的 */
  used: number;
  version: number;
  updated_at: string | null;
};

export type UserSubscription = {
  plan_id: number;
  quota_kind: string;
  quota_limit: number;
  quota_used: number;
  period_start: string | null;
  period_end: string | null;
};

/** 管理端列表与详情共用的形状：User 加余额、预算与当前订阅 */
export type UserView = AdminUser & {
  balance: number;
  /** 没设过也是完整形状，不用判空 */
  budget: UserBudget;
  /** 没订阅时为 null */
  subscription: UserSubscription | null;
};

export type AdminApiKey = {
  id: number;
  user_id: number;
  name: string | null;
  key_prefix: string;
  key_suffix: string | null;
  status: number;
  model_whitelist: string[] | null;
  rate_limit_per_min: number | null;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

/** 签发响应：key 是明文，只在这一个响应里出现一次 */
export type CreatedApiKey = {
  id: number;
  name: string | null;
  key: string;
  key_prefix: string;
  expires_at: string | null;
};

/** 套餐下拉只要 id 与名字 */
export type PlanOption = { id: number; name: string };

/* ------------------------------------------------------------ 展示口径 */

export const USER_STATUS_LABEL: Record<number, string> = {
  1: "正常",
  0: "已封禁",
};

export function userStatusLabel(status: number) {
  return USER_STATUS_LABEL[status] ?? `状态 ${status}`;
}

/** 密钥只回前后缀，中间固定用省略号：既认得出来，也不泄露 */
export function maskApiKey(key: Pick<AdminApiKey, "key_prefix" | "key_suffix">) {
  return key.key_suffix ? `${key.key_prefix}……${key.key_suffix}` : `${key.key_prefix}……`;
}

/* ------------------------------------------------------------------ 列表 */

/** order 只有 asc 生效，其余一律降序（接口就是这么定的） */
export type UserSort = "created_at" | "updated_at" | "credit_limit" | "name";

export type UserListParams = {
  page: number;
  size: number;
  /** 同时按用户名与邮箱模糊匹配 */
  keyword?: string;
  /** 1 只看正常、0 只看已封禁；不给就是不筛状态。非法值后端按不筛处理 */
  status?: 0 | 1;
  sort?: UserSort;
  order?: "asc" | "desc";
};

/** 列表。status 由服务端筛，total 也是筛选后的总数，页码条拿它算页数 */
export function fetchUsers(params: UserListParams) {
  return getList<UserView>(
    `/api/admin/users${query({
      page: params.page,
      size: params.size,
      keyword: params.keyword,
      status: params.status,
      sort: params.sort,
      order: params.order,
    })}`,
  );
}

/**
 * 兼容名。admin-keys.ts 里原来另写了一份同样的请求，现在只有这一个实现；
 * 密钥页与通知页的用户下拉走的就是它。与 fetchUsers 是同一件事，
 * 只是默认取第一页 100 条 —— 下拉要一次铺够选项。
 */
export function fetchAdminUsers(params: UserListParams = { page: 1, size: 100 }) {
  return fetchUsers({
    page: params.page ?? 1,
    size: params.size ?? 100,
    keyword: params.keyword,
    status: params.status,
    sort: params.sort,
    order: params.order,
  });
}

export function fetchUser(id: number) {
  return getData<UserView>(`/api/admin/users/${id}`);
}

/* ------------------------------------------------------------ 建 / 改 / 停 */

export type CreateUserInput = {
  name: string;
  email?: string | null;
  /** 不传则由后端用随机串占位，账号「已建但还不能登录」 */
  password?: string;
  credit_limit?: number;
  plan_id?: number | null;
};

export function createUser(input: CreateUserInput) {
  return postData<AdminUser>("/api/admin/users", input);
}

export type UpdateUserInput = {
  name?: string;
  status?: 0 | 1;
  credit_limit?: number;
  /** null 表示解绑 */
  plan_id?: number | null;
  email?: string | null;
  /** 改了会让该用户所有会话失效（后端自增 token_version） */
  password?: string;
  role?: "user" | "admin";
};

export function updateUser(id: number, patch: UpdateUserInput) {
  return putOk(`/api/admin/users/${id}`, patch);
}

/** 软删：只把 status 置 0，余额与流水全保留 */
export function disableUser(id: number) {
  return deleteOk(`/api/admin/users/${id}`);
}

/** 恢复入口：把 status 置回 1 */
export function enableUser(id: number) {
  return updateUser(id, { status: 1 });
}

/* ------------------------------------------------------------------ 预算 */

export type BudgetPeriod = "day" | "week" | "month";

export type BudgetInput = {
  enabled: boolean;
  amount: number;
  period: BudgetPeriod;
};

/** enabled=false 或 amount=0 都表示清除预算 */
export function setUserBudget(id: number, input: BudgetInput) {
  return putData<UserBudget>(`/api/admin/users/${id}/budget`, input);
}

/* ------------------------------------------------------------------ 密钥 */

export async function fetchUserKeys(userId: number) {
  const data = await getList<AdminApiKey>(`/api/admin/users/${userId}/api_keys`);
  return data.items ?? [];
}

export type CreateKeyInput = {
  name?: string | null;
  expires_at?: string | null;
};

/** 返回的 key 是明文，只此一次 */
export function createUserKey(userId: number, input: CreateKeyInput = {}) {
  return postData<CreatedApiKey>(`/api/admin/users/${userId}/api_keys`, input);
}

export function revokeUserKey(keyId: number) {
  return deleteOk(`/api/admin/api_keys/${keyId}`);
}

/* ------------------------------------------------------------------ 套餐 */

/** 套餐下拉的数据源。默认只回 status=1 的套餐 */
export async function fetchPlanOptions() {
  const data = await getList<{ id: number; name: string }>("/api/admin/plans");
  return (data.items ?? []).map(plan => ({ id: plan.id, name: plan.name }));
}
