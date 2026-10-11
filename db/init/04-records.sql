-- 记录表与充值单。
--
-- 两张记录表的字段照 openapi.yaml 的 RequestRecord 与 BillingRecord 抄，
-- 这两组接口本机一直没实现（标的是 remote），因为数据的产生方是转发内核。
-- 表先按定义建出来，摄入接口也先写好，等网关回写就能直接查。
--
-- 幂等键都取 request_id：网关重发同一条日志时按它去重，不会记两遍账。

-- 一次调用的记录（含失败）。用量与错误信息都在这张表上。
CREATE TABLE IF NOT EXISTS request_records (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- 网关生成的请求标识，也是幂等键
  request_id        VARCHAR(64)     NOT NULL,
  user_id           BIGINT UNSIGNED DEFAULT NULL,
  api_key_id        BIGINT UNSIGNED DEFAULT NULL,
  -- 客户端请求的模型名与实际上游服务的模型名，跨渠道改写时两者不同
  model             VARCHAR(128)    DEFAULT NULL,
  served_model      VARCHAR(128)    DEFAULT NULL,
  -- 入口：chat / responses / messages / gemini 之类
  entry             VARCHAR(32)     DEFAULT NULL,
  stream            TINYINT         NOT NULL DEFAULT 0,
  channel           VARCHAR(128)    DEFAULT NULL,
  channel_type      VARCHAR(32)     DEFAULT NULL,
  base_url          VARCHAR(512)    DEFAULT NULL,
  -- in_progress / success / error
  status            VARCHAR(16)     NOT NULL DEFAULT 'in_progress',
  http_status       INT             DEFAULT NULL,
  error_message     TEXT            DEFAULT NULL,
  error_code        VARCHAR(64)     DEFAULT NULL,
  render_status     INT             DEFAULT NULL,
  upstream_code     VARCHAR(64)     DEFAULT NULL,
  upstream_message  TEXT            DEFAULT NULL,
  -- 给用户看的那句话，可能与 upstream_message 不同
  panel_message     TEXT            DEFAULT NULL,
  attempts          INT             DEFAULT NULL,
  retried           TINYINT         DEFAULT NULL,
  user_agent        VARCHAR(512)    DEFAULT NULL,
  reasoning_effort  VARCHAR(32)     DEFAULT NULL,
  latency_ms        INT             DEFAULT NULL,
  -- 首字节耗时
  ttfb_ms           INT             DEFAULT NULL,
  -- 每秒 token
  tps               DECIMAL(14,4)   DEFAULT NULL,
  prompt_tokens     BIGINT          DEFAULT NULL,
  completion_tokens BIGINT          DEFAULT NULL,
  cache_read_tokens BIGINT          DEFAULT NULL,
  cache_write_tokens BIGINT         DEFAULT NULL,
  total_tokens      BIGINT          DEFAULT NULL,
  started_at        DATETIME(3)     DEFAULT NULL,
  finished_at       DATETIME(3)     DEFAULT NULL,
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_request_records_request (request_id),
  KEY idx_request_records_user (user_id, created_at),
  KEY idx_request_records_model (model, created_at),
  KEY idx_request_records_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 计费流水。与 request_records 一对一，分开是因为计费只对成功的调用产生，
-- 而调用记录里失败也要留痕。
--
-- cost_* 是成本侧（付给上游），revenue_* 是收入侧（向用户收），
-- owner_credit_amount 是分享给上游账号属主的额度。
CREATE TABLE IF NOT EXISTS billing_records (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id              VARCHAR(64)     NOT NULL,
  user_id                 BIGINT UNSIGNED DEFAULT NULL,
  api_key_id              BIGINT UNSIGNED DEFAULT NULL,
  plan_id                 BIGINT UNSIGNED DEFAULT NULL,
  channel_id              BIGINT UNSIGNED DEFAULT NULL,
  channel_name            VARCHAR(128)    DEFAULT NULL,
  owner_user_id           BIGINT UNSIGNED DEFAULT NULL,
  entry                   VARCHAR(32)     DEFAULT NULL,
  model                   VARCHAR(128)    DEFAULT NULL,
  stream                  TINYINT         NOT NULL DEFAULT 0,
  -- 用量从哪来的：上游返回、本地估算之类
  usage_source            VARCHAR(32)     DEFAULT NULL,
  charge_mode             VARCHAR(32)     DEFAULT NULL,
  cost_multiplier         DECIMAL(14,8)   NOT NULL DEFAULT 1,
  cost_multiplier_rules   JSON            DEFAULT NULL,
  cost_amount             DECIMAL(18,8)   NOT NULL DEFAULT 0,
  revenue_multiplier      DECIMAL(14,8)   NOT NULL DEFAULT 1,
  revenue_multiplier_rules JSON           DEFAULT NULL,
  revenue_amount          DECIMAL(18,8)   NOT NULL DEFAULT 0,
  owner_credit_amount     DECIMAL(18,8)   NOT NULL DEFAULT 0,
  currency                CHAR(3)         NOT NULL DEFAULT 'CNY',
  billing_mode            VARCHAR(32)     DEFAULT NULL,
  -- 这笔走的是订阅额度还是余额
  ledger                  VARCHAR(16)     DEFAULT NULL,
  latency_ms              INT             DEFAULT NULL,
  http_status             INT             DEFAULT NULL,
  attempts                INT             DEFAULT NULL,
  retried                 TINYINT         DEFAULT NULL,
  status                  VARCHAR(16)     NOT NULL DEFAULT 'settled',
  prompt_tokens           BIGINT          NOT NULL DEFAULT 0,
  completion_tokens       BIGINT          NOT NULL DEFAULT 0,
  cache_read_tokens       BIGINT          NOT NULL DEFAULT 0,
  cache_write_tokens      BIGINT          NOT NULL DEFAULT 0,
  total_tokens            BIGINT          NOT NULL DEFAULT 0,
  created_at              DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_billing_records_request (request_id),
  KEY idx_billing_records_user (user_id, created_at),
  KEY idx_billing_records_model (model, created_at),
  KEY idx_billing_records_channel (channel_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 充值单。用户自助充值走这里，管理员代充不经过它（那条路直接记 credit_transactions）。
--
-- order_no 是本机单号，external_no 是渠道流水号。回调按 order_no 幂等：
-- 同一张单重复回调只在第一次入账，credit_transaction_id 记下入账的那条流水，
-- 这样「这张单有没有真的入过账」一眼可查。
CREATE TABLE IF NOT EXISTS recharge_orders (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_no              VARCHAR(64)     NOT NULL,
  user_id               BIGINT UNSIGNED NOT NULL,
  amount                DECIMAL(14,8)   NOT NULL,
  currency              CHAR(3)         NOT NULL DEFAULT 'CNY',
  -- mock / wechat / alipay / stripe
  channel               VARCHAR(24)     NOT NULL DEFAULT 'mock',
  -- pending / paid / failed / cancelled / refunded
  status                VARCHAR(16)     NOT NULL DEFAULT 'pending',
  external_no           VARCHAR(128)    DEFAULT NULL,
  paid_at               DATETIME(3)     DEFAULT NULL,
  credit_transaction_id BIGINT UNSIGNED DEFAULT NULL,
  created_at            DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_recharge_orders_no (order_no),
  KEY idx_recharge_orders_user (user_id, created_at),
  KEY idx_recharge_orders_external (channel, external_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
