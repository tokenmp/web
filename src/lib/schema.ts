import { bigint, datetime, decimal, mysqlTable, tinyint, varchar } from "drizzle-orm/mysql-core";

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
