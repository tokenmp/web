/**
 * 系统级数据（版本、公告、通知）的客户端入口。
 *
 * 走的是 src/routes/api 下已经落地的接口，字段名与 openapi.yaml 一致（snake_case）。
 * 请求都是同源的，会话 cookie 由浏览器自己带上，不用再设 Authorization。
 */

import { ApiError, getList, query, request } from "./api-client";

export type Severity = "info" | "warning" | "urgent";

/** 级别公告和通知共用一份，前端不再各写一套映射 */
export const severityLabels: Record<string, string> = {
  info: "提示",
  warning: "注意",
  urgent: "重要",
};

export const announcementStatusLabels: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  archived: "已归档",
};

export type SystemVersion = {
  version: string | null;
  released_at: string | null;
  channel: string | null;
};

export type Announcement = {
  id: number;
  title: string;
  body: string;
  severity: string;
  scope: string;
  /** 用户能不能自己关掉 */
  dismissible: boolean;
  status: string;
  sort_order: number;
  publish_from: string | null;
  publish_until: string | null;
  /** 当前登录用户是不是关过这条；未登录时恒为 false */
  dismissed: boolean;
};

export type NotificationItem = {
  id: number;
  /** 业务类型，比如 balance_low、key_expiring */
  type: string;
  title: string;
  body: string | null;
  severity: string;
  action_label: string | null;
  action_url: string | null;
  metadata: unknown;
  /** 为空即未读 */
  read_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export type NotificationFeed = {
  items: NotificationItem[];
  total: number;
  /** 接口顺手带回来的未读数，省得再请求一次 */
  unread: number;
};

/** 请求客户端与 ApiError 都在 src/lib/api-client.ts，这里原样转出，免得改调用方 */
export { ApiError, request };

/* ------------------------------------------------------------------ 版本 */

/** 公开接口，页脚用。没有配置时三个字段都是 null */
export function fetchSystemVersion() {
  return request<SystemVersion>("/api/system/version");
}

/* ------------------------------------------------------------------ 公告 */

/** 生效中的公告。登录后每条的 dismissed 是当前用户的关闭状态 */
export async function fetchAnnouncements() {
  const data = await request<{ items: Announcement[]; total: number }>("/api/announcements");
  return data.items ?? [];
}

/** 记下「当前用户关掉了这条」。未登录会拿到 401，由调用方退回本地记录 */
export function dismissAnnouncement(id: number) {
  return request<{ ok: boolean }>(`/api/announcements/${id}/dismiss`, { method: "POST" });
}

/* ------------------------------------------------------------------ 通知 */

export function fetchNotifications(options: { unreadOnly?: boolean; size?: number } = {}) {
  const params = new URLSearchParams();
  if (options.unreadOnly) params.set("unread", "1");
  params.set("size", String(options.size ?? 20));
  return request<NotificationFeed>(`/api/notifications?${params.toString()}`);
}

/** 幂等：已经读过的再标一次也返回 ok */
export function markNotificationRead(id: number) {
  return request<{ ok: boolean; read_at: string }>(`/api/notifications/${id}/read`, {
    method: "POST",
  });
}

export function markAllNotificationsRead() {
  return request<{ ok: boolean; updated: number }>("/api/notifications/read-all", {
    method: "POST",
  });
}

/* ------------------------------------------------------- 管理端：公告 */

/**
 * 公告的三个状态，与后端 `src/routes/api/admin/announcements.ts` 里的 STATUSES 同一份取值。
 * 卡片计数与筛选都按这个顺序对，另处不要再写一遍字面量。
 */
export const ANNOUNCEMENT_STATUSES = ["draft", "published", "archived"] as const;

/** 管理端公告列表的查询条件。status 传 undefined 表示不筛 */
export type AdminAnnouncementQuery = {
  page?: number;
  size?: number;
  status?: string;
};

/**
 * 管理端列表，草稿与归档的也在里面。
 *
 * 收 page / size / status 并把 `total` 一起返回 —— 后端一直是分页接口（默认一页 20 条），
 * 早先这里只回 `items`，页面上就把它当成了全部：统计卡、条数、翻页全按第一页算。
 */
export function fetchAdminAnnouncements(input: AdminAnnouncementQuery = {}) {
  return getList<Announcement>(
    `/api/admin/announcements${query({
      page: input.page,
      size: input.size,
      status: input.status,
    })}`,
  );
}

/**
 * 每个状态的公告各有多少条，给页头那四张卡用。
 *
 * 列表是分页的，本页的 items 里数不出全量 —— 「已发布」有 30 条而当前停在草稿页时，
 * 数 items 会得出 0。所以按状态各发一次只取 total 的请求（`size=1`，服务端仍会走一次
 * count）。四个状态就是四次请求，公告量级不大，换来的是卡片与列表同为全站口径。
 */
export async function fetchAnnouncementCounts() {
  const [all, ...byStatus] = await Promise.all([
    getList<Announcement>("/api/admin/announcements?page=1&size=1"),
    ...ANNOUNCEMENT_STATUSES.map(status =>
      getList<Announcement>(`/api/admin/announcements?page=1&size=1&status=${status}`),
    ),
  ]);

  const counts: Record<string, number> = { total: all.total };
  ANNOUNCEMENT_STATUSES.forEach((status, index) => {
    counts[status] = byStatus[index].total;
  });
  return counts as { total: number } & Record<(typeof ANNOUNCEMENT_STATUSES)[number], number>;
}

export type AnnouncementInput = {
  title: string;
  body: string;
  severity: Severity;
  dismissible: boolean;
  /** ISO 字符串；为空表示从现在开始生效 */
  publish_from?: string | null;
  /** ISO 字符串；为空表示一直有效 */
  publish_until?: string | null;
};

/** 新建出来的是草稿，发布是单独的动作 */
export function createAnnouncement(input: AnnouncementInput) {
  return request<{ data: Announcement }>("/api/admin/announcements", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAnnouncement(id: number, input: AnnouncementInput) {
  return request<{ data: Announcement }>(`/api/admin/announcements/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function publishAnnouncement(id: number) {
  return request<{ data: Announcement }>(`/api/admin/announcements/${id}/publish`, {
    method: "POST",
  });
}

export function archiveAnnouncement(id: number) {
  return request<{ data: Announcement }>(`/api/admin/announcements/${id}/archive`, {
    method: "POST",
  });
}

export function deleteAnnouncement(id: number) {
  return request<{ ok: boolean }>(`/api/admin/announcements/${id}`, { method: "DELETE" });
}
