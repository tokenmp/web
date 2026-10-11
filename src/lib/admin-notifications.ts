/**
 * 管理端通知投递的客户端入口。
 *
 * 与用户端通知（/api/notifications，见 system.ts）的区别：
 *   - 用户端只读自己的，管理端能看全量投递记录并给指定用户发
 *   - 投递记录比用户端通知多 user_id 与 idempotency_key 两个管理端字段
 *
 * 幂等键的语义由后端定：带 idempotency_key 时按它去重，批量发会在键后接上用户 id，
 * 否则所有人共用一个键、只有第一个收得到。界面必须把这一点写给运营看。
 */

import { getList, query, request } from "./api-client";
import type { NotificationItem } from "./system";

/** 投递记录 = 用户端通知 + 管理端字段 */
export type AdminNotification = NotificationItem & {
  user_id: number;
  idempotency_key: string | null;
};

export type NotificationSeverity = "info" | "warning" | "urgent";

export type NotificationInput = {
  /** 单个用户。与 user_ids 至少给一个 */
  user_id?: number;
  /** 批量用户。服务端会去重并逐个校验存在性 */
  user_ids?: number[];
  type?: string;
  title: string;
  body?: string | null;
  severity?: NotificationSeverity;
  action_label?: string | null;
  action_url?: string | null;
  metadata?: Record<string, unknown> | null;
  expires_at?: string | null;
  idempotency_key?: string | null;
};

export type NotificationFeed = {
  items: AdminNotification[];
  total: number;
};

export function fetchAdminNotifications(
  options: { page?: number; size?: number; user_id?: number; type?: string } = {},
) {
  return getList<AdminNotification>(
    `/api/admin/notifications${query({
      page: options.page,
      size: options.size,
      user_id: options.user_id,
      type: options.type,
    })}`,
  );
}

/**
 * 发通知。响应是顶层的 { ok, created }，没有 data 信封，所以直接用 request。
 * created 是目标用户数，用来告诉运营这次实际投给了几个人。
 */
export function sendAdminNotifications(input: NotificationInput) {
  return request<{ ok: boolean; created: number }>("/api/admin/notifications", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
