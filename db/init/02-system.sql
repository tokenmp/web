-- 系统级的三块东西：版本、公告、通知。
--
-- 字段照着线上 postgres 的 announcements / notifications / user_release_reads 来，
-- 但主键换成本地的 bigint 自增，对齐 users 表的 id 类型（线上用的是 uuid）。
--
-- 三者的分工：
--   版本   system_config 里的一条记录，前端在页脚显示；发布说明走公告
--   公告   面向全站，带级别、生效时间窗、可否关闭；线上「v0.1.0 正式发布」就是一条公告
--   通知   面向单个用户，有已读时间、动作按钮、幂等键

-- 键值配置。系统版本号存在这里，key = 'system_version'。
CREATE TABLE IF NOT EXISTS system_config (
  `key`      VARCHAR(100) NOT NULL,
  value      JSON         NOT NULL,
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 版本信息。version 是展示用的版本号，released_at 是对外说的发布日期，
-- channel 用来区分 dev 与正式环境，前端拿这几个字段拼页脚。
INSERT INTO system_config (`key`, value)
VALUES ('system_version', JSON_OBJECT('version', '0.1.0', 'released_at', '2026-10-10', 'channel', 'dev'))
ON DUPLICATE KEY UPDATE `key` = `key`;

-- 公告。
--   severity    info / warning / urgent
--   scope       作用范围，现只有 all
--   status      draft / published / archived
--   dismissible 用户能不能自己关掉
--   publish_from / publish_until 生效时间窗，until 为空表示一直有效
CREATE TABLE IF NOT EXISTS announcements (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title         VARCHAR(255)    NOT NULL,
  body          TEXT            NOT NULL,
  severity      VARCHAR(32)     NOT NULL DEFAULT 'info',
  scope         VARCHAR(64)     NOT NULL DEFAULT 'all',
  dismissible   TINYINT(1)      NOT NULL DEFAULT 1,
  status        VARCHAR(32)     NOT NULL DEFAULT 'draft',
  sort_order    INT             NOT NULL DEFAULT 0,
  publish_from  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  publish_until DATETIME(3)     DEFAULT NULL,
  created_by    BIGINT UNSIGNED DEFAULT NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_announcements_status (status, publish_from),
  KEY idx_announcements_window (publish_from, publish_until),
  CONSTRAINT fk_announcements_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 通知。
--   type            业务类型，用来让前端挑图标，比如 balance_low、key_expiring
--   severity        info / warning / urgent
--   action_label    action_url 的按钮文字
--   metadata        业务侧附带的 JSON，前端自己解释
--   read_at         为空表示未读
--   idempotency_key 幂等键，同一个业务事件重复投递时靠它去重；为空表示不去重
CREATE TABLE IF NOT EXISTS notifications (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  type            VARCHAR(64)     NOT NULL DEFAULT '',
  title           VARCHAR(255)    NOT NULL,
  body            TEXT,
  severity        VARCHAR(32)     NOT NULL DEFAULT 'info',
  action_label    VARCHAR(128)    DEFAULT NULL,
  action_url      VARCHAR(512)    DEFAULT NULL,
  metadata        JSON            DEFAULT NULL,
  read_at         DATETIME(3)     DEFAULT NULL,
  expires_at      DATETIME(3)     DEFAULT NULL,
  idempotency_key VARCHAR(128)    DEFAULT NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- MySQL 的唯一索引允许多个 NULL，等价于线上那条带 WHERE 的部分唯一索引
  UNIQUE KEY uk_notifications_idempotency (idempotency_key),
  KEY idx_notifications_user_read (user_id, read_at),
  KEY idx_notifications_user_created (user_id, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 用户关掉了哪条公告。线上用 user_release_reads 记「读过哪个版本」，
-- 但公告本身没有 per-user 状态，这里补上，免得换台设备又把关过的公告弹出来。
CREATE TABLE IF NOT EXISTS announcement_dismissals (
  user_id         BIGINT UNSIGNED NOT NULL,
  announcement_id BIGINT UNSIGNED NOT NULL,
  dismissed_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, announcement_id),
  KEY idx_announcement_dismissals_announcement (announcement_id),
  CONSTRAINT fk_announcement_dismissals_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_announcement_dismissals_announcement FOREIGN KEY (announcement_id) REFERENCES announcements (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 两条种子数据，新起的库一登录就能看到公告条和通知铃铛的样子。
--
-- 都写了 WHERE NOT EXISTS：init 脚本在数据卷还在时会被再跑一遍
-- （docker compose up 每次都会执行 db/init 下的脚本），不带这个条件会插重复。

-- 一条已发布的公告。线上「v0.1.0 正式发布」就是这么发的，不分开发版说明和公告。
INSERT INTO announcements (title, body, severity, scope, dismissible, status, sort_order, publish_from)
SELECT 'v0.1.0 正式发布',
       '控制台上线：用户、余额、计费、渠道几个模块都可以用了。\n有问题在控制台里提，或直接回邮件。',
       'info', 'all', 1, 'published', 0, NOW(3)
WHERE NOT EXISTS (SELECT 1 FROM announcements);

-- 一条欢迎通知，发给控制台管理员。库里还没有管理员时这条不会插进去 ——
-- 用户是从线上导进来的，导入时再跑一次这个脚本就有了。
INSERT INTO notifications (user_id, type, title, body, severity, action_label, action_url, idempotency_key, created_at)
SELECT u.id, 'system_welcome', '欢迎使用 TokenMP 控制台',
       '左侧是全部功能，右上角可以切主题、退出登录。', 'info',
       '看看概览', '/dashboard', 'seed:system_welcome', NOW(3)
FROM users u
WHERE u.role = 'admin'
  AND NOT EXISTS (SELECT 1 FROM notifications WHERE idempotency_key = 'seed:system_welcome')
LIMIT 1;
