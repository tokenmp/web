-- 用户表。
--
-- 字段对齐线上 mysql `sales`.`users`，只在末尾加了一个 source 列，
-- 用来标记这条记录是从哪套线上系统导入的（线上有两套用户表：
-- mysql sales 里的 1 个控制台管理员，postgres tokenmp_next 里的 261 个用户端用户）。
--
-- password_hash 原样保存线上的 bcrypt 哈希（$2y$12$ / $2b$10$ / $2a$10$ 三种前缀），
-- 不做二次哈希，否则线上用户就没法用原密码登录了。

CREATE TABLE IF NOT EXISTS users (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- sales.users 里 name 是 NOT NULL UNIQUE；postgres 的用户只有 email，
  -- 导入时用邮箱 @ 前面那段当 name，重名再加数字后缀
  name           VARCHAR(64)     NOT NULL,
  email          VARCHAR(191)    DEFAULT NULL,
  password_hash  VARCHAR(255)    NOT NULL,
  role           VARCHAR(16)     NOT NULL DEFAULT 'user',
  -- 1 = 正常，0 = 停用，沿用 sales 的约定
  status         TINYINT         NOT NULL DEFAULT 1,
  credit_limit   DECIMAL(14,8)   NOT NULL DEFAULT 0,
  plan_id        BIGINT UNSIGNED DEFAULT NULL,
  -- 改密码时自增，用来让已经签发的 token 失效
  token_version  BIGINT          NOT NULL DEFAULT 0,
  source         VARCHAR(16)     NOT NULL DEFAULT 'local',
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_email (email),
  UNIQUE KEY uk_users_name (name),
  KEY idx_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
