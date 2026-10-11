-- 业务表：余额账本、密钥、套餐、订阅。
--
-- 这一组只装业务数据 —— 管理员配置的、用户自己产生的。转发产生的用量与调用日志
-- 另有表，等网关那侧把数据送过来再建。
--
-- 时间统一 UTC，跟 01/02 一致；金额统一 DECIMAL(14,8)，单位是元，
-- 用户面板展示时乘 10000 转积分（见 src/lib/utils.ts 的 POINTS_PER_YUAN）。
--
-- 01-schema.sql 里已经带了 balance 与 credit_used 两列，新库不会走到下面的 ALTER；
-- 但已经建过库的卷不会重跑 01，所以这里补一段幂等的加列，老库手工执行这个文件也能对齐。

SET @add_balance = (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'balance') = 0,
    'ALTER TABLE users ADD COLUMN balance DECIMAL(14,8) NOT NULL DEFAULT 0 AFTER credit_limit',
    'DO 0'
  )
);
PREPARE stmt FROM @add_balance;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_credit_used = (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'credit_used') = 0,
    'ALTER TABLE users ADD COLUMN credit_used DECIMAL(14,8) NOT NULL DEFAULT 0 AFTER balance',
    'DO 0'
  )
);
PREPARE stmt FROM @add_credit_used;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 预算封顶。存储与展示在本地，判定在网关侧 —— 网关读这张表决定要不要拦请求。
-- enabled=0 或 amount=0 都表示没设预算，两个条件都要判，因为线上的接口
-- 用 enabled=false 清除、页面又可能把 amount 填成 0，只判一个会漏。
CREATE TABLE IF NOT EXISTS user_budgets (
  user_id        BIGINT UNSIGNED NOT NULL,
  enabled        TINYINT         NOT NULL DEFAULT 0,
  amount         DECIMAL(14,8)   NOT NULL DEFAULT 0,
  period         VARCHAR(8)      NOT NULL DEFAULT 'month',
  period_start   DATETIME(3)     DEFAULT NULL,
  period_end     DATETIME(3)     DEFAULT NULL,
  used           DECIMAL(14,8)   NOT NULL DEFAULT 0,
  -- 每次改动自增，网关拿它判断自己缓存的预算是不是过期了
  version        BIGINT          NOT NULL DEFAULT 0,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- API 密钥。明文只在签发那一次返回，库里只存 sha256，任何查询都回不来原文。
-- key_prefix 存明文前 9 位（形如 sk-abc123），key_suffix 存末 6 位，
-- 列表里靠这两段让用户认出是哪一把。
CREATE TABLE IF NOT EXISTS api_keys (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id            BIGINT UNSIGNED NOT NULL,
  name               VARCHAR(64)     DEFAULT NULL,
  key_hash           CHAR(64)        NOT NULL,
  key_prefix         VARCHAR(16)     NOT NULL,
  key_suffix         VARCHAR(8)      DEFAULT NULL,
  -- 1 = 正常，0 = 已删/已停用。删是硬删，这个字段留给网关那边标记失效
  status             TINYINT         NOT NULL DEFAULT 1,
  model_whitelist    JSON            DEFAULT NULL,
  rate_limit_per_min INT             DEFAULT NULL,
  expires_at         DATETIME(3)     DEFAULT NULL,
  -- 网关回写的最近使用时间，本地签发时为空
  last_used_at       DATETIME(3)     DEFAULT NULL,
  created_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_api_keys_hash (key_hash),
  KEY idx_api_keys_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 余额流水。balance_after 是快照，不是算出来的 —— 对账时要能复现「那一刻账户是多少」。
-- source 的取值与线上一致：recharge 充值、adjust 手工调账、usage 用量扣费、
-- channel_share 分享渠道的返额、subscription 订阅扣款。
-- 本机另加一个 refund：退给用户的钱，与 recharge 分开，对账时能单独拉出来。
-- balance_part 与 credit_part 记这次变动分别落在余额和信用上多少，
-- 正负号跟 delta 同向：入账为正表示还了多少信用/进了多少余额，扣款为负表示扣了多少。
CREATE TABLE IF NOT EXISTS credit_transactions (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  delta             DECIMAL(14,8)   NOT NULL,
  balance_after     DECIMAL(14,8)   NOT NULL,
  credit_used_after DECIMAL(14,8)   NOT NULL DEFAULT 0,
  source            VARCHAR(16)     NOT NULL,
  ref_id            VARCHAR(64)     DEFAULT NULL,
  reason            VARCHAR(256)    DEFAULT NULL,
  operator          VARCHAR(64)     DEFAULT NULL,
  model             VARCHAR(128)    DEFAULT NULL,
  total_tokens      BIGINT          DEFAULT NULL,
  balance_part      DECIMAL(14,8)   NOT NULL DEFAULT 0,
  credit_part       DECIMAL(14,8)   NOT NULL DEFAULT 0,
  -- 扣的是订阅额度还是余额；用量类流水才有
  ledger            VARCHAR(16)     DEFAULT NULL,
  detail            JSON            DEFAULT NULL,
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ct_user (user_id, created_at),
  KEY idx_ct_source (source, created_at),
  KEY idx_ct_ref (ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 套餐。字段照 openapi 的 PlanCore，另加三个本机扩展：
--   features    销售页卡片上的卖点清单，线上是从别处取的，这里直接存
--   recommended 卡片上打推荐标
--   sort_order  卡片排列顺序，数字小的排前面
-- subscribers 不存列，从 subscriptions 现算，避免两个地方对不上。
-- 删套餐是软删（status=0），因为流水和历史订阅还引用着它。
CREATE TABLE IF NOT EXISTS plans (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name              VARCHAR(64)     NOT NULL,
  -- pay_as_you_go 按量付费 | subscription 订阅制
  mode              VARCHAR(24)     NOT NULL,
  -- markup 按成本乘倍率 | table 按 plan_prices 逐模型定价
  pricing_mode      VARCHAR(16)     NOT NULL,
  markup_multiplier DECIMAL(14,8)   NOT NULL DEFAULT 1,
  rate_rules        JSON            DEFAULT NULL,
  quota_kind        VARCHAR(16)     NOT NULL DEFAULT 'money',
  quota_amount      DECIMAL(18,8)   NOT NULL DEFAULT 0,
  quota_period_days INT             NOT NULL DEFAULT 30,
  -- disabled 超额停用 | bill 超额继续计费
  overage_mode      VARCHAR(16)     NOT NULL DEFAULT 'disabled',
  price             DECIMAL(14,8)   NOT NULL DEFAULT 0,
  currency          CHAR(3)         NOT NULL DEFAULT 'CNY',
  status            TINYINT         NOT NULL DEFAULT 1,
  features          JSON            DEFAULT NULL,
  recommended       TINYINT         NOT NULL DEFAULT 0,
  sort_order        INT             NOT NULL DEFAULT 0,
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_plans_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 套餐里针对单个模型的定价。pricing_mode=table 的套餐才用得上，
-- 每个模型一条，同一个套餐下不许重复（重复了算不准钱）。
CREATE TABLE IF NOT EXISTS plan_prices (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_id                BIGINT UNSIGNED NOT NULL,
  model                  VARCHAR(128)    NOT NULL,
  cost_mode              VARCHAR(16)     NOT NULL DEFAULT 'token',
  input_per_million      DECIMAL(18,8)   NOT NULL DEFAULT 0,
  output_per_million     DECIMAL(18,8)   NOT NULL DEFAULT 0,
  cache_read_per_million DECIMAL(18,8)   NOT NULL DEFAULT 0,
  cache_write_per_million DECIMAL(18,8)  NOT NULL DEFAULT 0,
  per_request            DECIMAL(18,8)   NOT NULL DEFAULT 0,
  request_weight         DECIMAL(14,8)   NOT NULL DEFAULT 1,
  created_at             DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at             DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_plan_prices_model (plan_id, model)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 订阅记录，一次激活一行。续费就是再来一行，老的那行留着当历史。
-- 当前订阅 = 这个用户 status='active' 且 period_end 最晚的那行。
-- status 的取值：active 生效中、expired 已过期、cancelled 用户取消、superseded 被换档取代。
-- 后两个都表示不再生效，但分得开：cancelled 是用户主动退的，superseded 是换套餐时旧的让位。
-- quota_used 由网关按用量回填，本地订阅时从 0 起。
CREATE TABLE IF NOT EXISTS subscriptions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  plan_id      BIGINT UNSIGNED NOT NULL,
  amount       DECIMAL(14,8)   NOT NULL DEFAULT 0,
  quota_kind   VARCHAR(16)     NOT NULL DEFAULT 'money',
  quota_limit  DECIMAL(18,8)   NOT NULL DEFAULT 0,
  quota_used   DECIMAL(18,8)   NOT NULL DEFAULT 0,
  period_start DATETIME(3)     DEFAULT NULL,
  period_end   DATETIME(3)     DEFAULT NULL,
  status       VARCHAR(16)     NOT NULL DEFAULT 'active',
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_subscriptions_user (user_id, period_end),
  KEY idx_subscriptions_plan (plan_id),
  -- 概览与激活列表都按「活跃且快到期」与「最近激活」筛，这两组各自需要一个索引，
  -- 不然数据一多就是全表扫
  KEY idx_subscriptions_status (status, period_end),
  KEY idx_subscriptions_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 种子套餐。跟用户面板示例数据里的五档对齐，新库起来就有东西可看。-- 都带 WHERE NOT EXISTS，因为 docker compose up 每次都会重跑这个文件。
INSERT INTO plans (id, name, mode, pricing_mode, markup_multiplier, quota_kind, quota_amount,
                   quota_period_days, overage_mode, price, currency, status, features, recommended, sort_order)
SELECT 1, '按量付费', 'pay_as_you_go', 'table', 1, 'money', 0, 0, 'bill', 0, 'CNY', 1,
       JSON_ARRAY('全量模型按原价调用', '余额不足即停用', '按次计费的用量明细', 'API 密钥不限数量'), 0, 10
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE id = 1);

INSERT INTO plans (id, name, mode, pricing_mode, markup_multiplier, quota_kind, quota_amount,
                   quota_period_days, overage_mode, price, currency, status, features, recommended, sort_order)
SELECT 2, '标准版月付', 'subscription', 'markup', 1.15, 'money', 68, 30, 'bill', 68, 'CNY', 1,
       JSON_ARRAY('每月 68 元额度', '全量模型可用', 'API 密钥 10 个', '账单与用量明细'), 0, 20
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE id = 2);

INSERT INTO plans (id, name, mode, pricing_mode, markup_multiplier, quota_kind, quota_amount,
                   quota_period_days, overage_mode, price, currency, status, features, recommended, sort_order)
SELECT 3, '专业版月付', 'subscription', 'markup', 1.1, 'money', 128, 30, 'bill', 128, 'CNY', 1,
       JSON_ARRAY('每月 128 元额度，单价九折', '高并发通道', '上游故障自动切换', '工单优先支持'), 1, 30
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE id = 3);

INSERT INTO plans (id, name, mode, pricing_mode, markup_multiplier, quota_kind, quota_amount,
                   quota_period_days, overage_mode, price, currency, status, features, recommended, sort_order)
SELECT 4, '轻量点数包', 'subscription', 'table', 1, 'requests', 20000, 30, 'disabled', 39, 'CNY', 1,
       JSON_ARRAY('每周期 20000 次调用', '超额停用不另行扣费', '适合小流量脚本'), 0, 40
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE id = 4);

INSERT INTO plans (id, name, mode, pricing_mode, markup_multiplier, quota_kind, quota_amount,
                   quota_period_days, overage_mode, price, currency, status, features, recommended, sort_order)
SELECT 5, '企业版年付', 'subscription', 'table', 1, 'money', 12800, 365, 'bill', 12800, 'CNY', 1,
       JSON_ARRAY('每年 12800 元额度', '专属通道', '支持对公结算与年度合同', '99.9% 可用性承诺'), 0, 50
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE id = 5);

-- subscriptions 的两组筛选索引。新库在 CREATE TABLE 里已经带了，
-- 这里给已经建过表的库补上，免得同一份脚本在新旧库里跑出不同结构。
SET @add_sub_status_idx = (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriptions'
        AND INDEX_NAME = 'idx_subscriptions_status') = 0,
    'ALTER TABLE subscriptions ADD KEY idx_subscriptions_status (status, period_end)',
    'DO 0'
  )
);
PREPARE stmt FROM @add_sub_status_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_sub_created_idx = (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriptions'
        AND INDEX_NAME = 'idx_subscriptions_created') = 0,
    'ALTER TABLE subscriptions ADD KEY idx_subscriptions_created (created_at)',
    'DO 0'
  )
);
PREPARE stmt FROM @add_sub_created_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
