-- 用户表。
--
-- 开头三句 SET 不能删、也不能挪到别的文件里：docker-entrypoint 是**一个文件起一次
-- mysql 客户端**，每次都是新会话。客户端字符集取自容器 locale，mysql 镜像默认没有
-- LANG，于是按 latin1 解释文件字节 —— 中文种子数据被双重编码后存进库（肉眼看是乱码，
-- HEX 与 utf8mb4 也对不上）。显式指定就不看容器的脸色，谁跑都一样。
-- 代价是每个 .sql 都得带一份；这四句必须留在各自文件的第一行（注释可以跟在后面）。
SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;
SET collation_connection = 'utf8mb4_0900_ai_ci';
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
  -- 可用余额。线上的 sales.users 没有这一列，余额另存在别的库里；
  -- 本地把账本收在这张表上，调账与订阅都在事务里直接改它。
  balance        DECIMAL(14,8)   NOT NULL DEFAULT 0,
  -- 已用掉的信用额度。剩余信用 = credit_limit - credit_used，不单独存。
  credit_used    DECIMAL(14,8)   NOT NULL DEFAULT 0,
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
