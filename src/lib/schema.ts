import {
  bigint,
  boolean,
  datetime,
  decimal,
  int,
  json,
  mysqlTable,
  primaryKey,
  text,
  tinyint,
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
