/**
 * 管理端「用户 × API 密钥」的客户端入口。
 *
 * 管理端没有「列出所有密钥」的端点，只有「某用户的密钥列表」，所以页面得先选用户。
 * 用户列表走 /api/admin/users，拿到的是真实 id。
 *
 * 明文密钥只在签发那一次返回（POST 的 data.key），之后库里只有 hash 与前后缀，
 * 任何列表接口都取不回原文，界面必须当场让管理员存下来。
 *
 * AdminUser 与 fetchAdminUsers 由 admin-users.ts 定义、这里只转发，
 * 免得同一份类型与同一个请求在两处各写一遍。
 */

import { deleteOk, getList, patchOk, postData } from "./api-client";

// 用户列表的类型与取数统一由 admin-users.ts 提供，这里只转发出去，
// api-keys.tsx / notifications.tsx 的 import 路径不用改。
export { fetchAdminUsers, type AdminUser } from "./admin-users";

export type AdminApiKey = {
  id: number;
  user_id: number;
  name: string | null;
  /** 明文前 9 个字符 */
  key_prefix: string;
  /** 明文末 6 位 */
  key_suffix: string | null;
  /** 1 启用，0 停用 */
  status: number;
  model_whitelist: string[] | null;
  rate_limit_per_min: number | null;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

/** 签发响应。key 是明文，只在这一次出现 */
export type IssuedApiKey = {
  id: number;
  name: string | null;
  key: string;
  key_prefix: string;
  expires_at: string | null;
};

/** PATCH 的 body，按子集传：只改传了的字段 */
export type ApiKeyPatch = {
  status?: number;
  name?: string | null;
  expires_at?: string | null;
  model_whitelist?: string[] | null;
  rate_limit_per_min?: number | null;
};

export type KeyState = "启用" | "已停用" | "已过期";

/** 某用户的密钥。用户不存在时后端回空列表，不报 404 */
export function fetchUserApiKeys(userId: number) {
  return getList<AdminApiKey>(`/api/admin/users/${userId}/api_keys`);
}

export function issueApiKey(userId: number, input: { name?: string; expires_at?: string | null }) {
  return postData<IssuedApiKey>(`/api/admin/users/${userId}/api_keys`, input);
}

/**
 * 改密钥。用 patchOk 而不是 patchData：页面改完总是重新拉一次列表，
 * 不消费响应体，这样后端回 { data } 还是 { ok } 都能用。
 */
export function updateApiKey(id: number, patch: ApiKeyPatch) {
  return patchOk(`/api/admin/api_keys/${id}`, patch);
}

/** 硬删。停用请用 updateApiKey(id, { status: 0 })，别拿删除冒充 */
export function deleteApiKey(id: number) {
  return deleteOk(`/api/admin/api_keys/${id}`);
}

/** 列表里展示的脱敏形式：前缀 + 掩码 + 末六位 */
export function maskedKey(key: Pick<AdminApiKey, "key_prefix" | "key_suffix">) {
  return `${key.key_prefix}····${key.key_suffix ?? ""}`;
}

/** 状态是数据列，过期是算出来的 —— 过期的那把 status 仍是 1，网关侧才拦 */
export function keyState(key: Pick<AdminApiKey, "status" | "expires_at">): KeyState {
  if (key.status === 0) return "已停用";
  if (key.expires_at && new Date(key.expires_at).getTime() < Date.now()) return "已过期";
  return "启用";
}

/** 模型白名单输入框：逗号、中文逗号、空白都当分隔符 */
export function splitModelWhitelist(text: string) {
  return text
    .split(/[\s,，]+/)
    .map(item => item.trim())
    .filter(item => item !== "");
}
