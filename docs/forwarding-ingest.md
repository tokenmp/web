# 转发内核要写进库的内容

这份是 `web` 与转发内核（`core` / `cli`）之间的数据对接说明。定义的是**转发产生、本机落库**的那部分数据，不含管理员配置（渠道、模型目录那些本机还没有表）。

表建在 [db/init/04-records.sql](../db/init/04-records.sql)，写入端点是 [src/routes/api/internal/records.ts](../src/routes/api/internal/records.ts)，落库逻辑与扣费在 [src/lib/records.ts](../src/lib/records.ts)，账本口径在 [src/lib/ledger.ts](../src/lib/ledger.ts)。字段名与响应形状以 [openapi.yaml](../openapi.yaml) 的 `RequestRecord` / `BillingRecord` 为准，本文讲**哪些字段必须给、什么时候给、给不上怎么办**。

## 一句话

转发每次调用推两行：**调用记录**（每次都写，含失败）与**计费流水**（仅成功且收入大于 0 时写）。两者用同一个 `request_id` 关联。本机收到后按计费金额扣费：走余额的还会写第三行 `credit_transactions`，走订阅额度的只累加 `subscriptions.quota_used`。

| 表 | 一行代表 | 什么时候写 |
| --- | --- | --- |
| `request_records` | 一次调用，成功失败都算 | 每次调用结束 |
| `billing_records` | 一次计费 | 调用成功且产生了费用 |
| `credit_transactions` | 一次余额/授信变动 | 走余额的那笔计费，摄入时由本机按 `revenue_amount` 扣费写一条；走订阅额度的那笔不写，见下面「摄入时一并记账」 |

网关只推前两张，第三张由本机在同一个事务里写。

## request_records

34 列：openapi 的 `RequestRecord` 28 个自有字段 + 共用的 5 个 token 计数，再加自增主键 `id`（`id` 不在 openapi 里，只在本机）。没有别的增减。

### 必须给的

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `request_id` | varchar(64) | 本次调用的唯一标识。**幂等键**，同一批重复提交靠它去重 |
| `status` | varchar(16) | `in_progress` / `success` / `error`。见下面「一次写还是两阶段」 |

### 强烈建议给（不给的话面板上会出现空白列）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | bigint | 客户端密钥归属的用户。缺了这条记录在用户面板里就看不见 |
| `api_key_id` | bigint | 用的是哪把客户端密钥 |
| `model` | varchar(128) | 客户端请求的模型名 |
| `served_model` | varchar(128) | 实际服务的上游模型名。跨渠道改名时与 `model` 不同 |
| `entry` | varchar(32) | 入口：`chat` / `responses` / `messages` / `gemini` |
| `stream` | tinyint | 是否流式，0/1 |
| `created_at` | datetime(3) | 调用开始时间。不给我就填当前时间，但那样时间线会偏 |

### 诊断用（有就给，排查时全靠它们）

| 列 | 说明 |
| --- | --- |
| `channel`、`channel_type`、`base_url` | 打到哪个上游 |
| `http_status` | 返回给客户端的 HTTP 状态 |
| `error_code`、`error_message` | 本机识别的错误 |
| `upstream_code`、`upstream_message` | 上游原样返回的错误 |
| `panel_message` | 给用户看的那句话，可以与 `upstream_message` 不同 |
| `render_status` | 渲染阶段的状态码 |
| `attempts`、`retried` | 试了几次、有没有重试过 |
| `user_agent`、`reasoning_effort` | 排查客户端与推理档位 |
| `latency_ms`、`ttfb_ms`、`tps` | 总耗时、首字节、每秒 token |
| `started_at`、`finished_at` | 起止时间。与 `created_at` 分开，流式请求里三者不同 |
| `prompt_tokens` 等五个 | 见下面「token 计数」 |

### token 计数

五个列都是 `bigint`。`request_records` 上可空（没数据就是 NULL），`billing_records` 上 `NOT NULL DEFAULT 0`（计费行总要有一个数，缺了当 0）。

口径要统一：`total = prompt + completion`。缓存读与缓存写**是 prompt 的一部分**——core 归一之后两者是 `PromptTokensDetails` 的 details（见 core 的 `server/access.go`），所以这两列单独记、但不要重复加进 `total`。按单价算钱时要先把它们从 prompt 里扣掉，再各按自己的单价算，否则命中的 token 会被收两遍，式子见 tokenmp/cli#34。谁产生这个数（上游返回还是本地估算）记在 `billing_records.usage_source` 上。

## billing_records

34 列：openapi 的 `BillingRecord` 29 个自有字段（含 `id`）+ 共用的 5 个 token 计数。没有别的增减。

### 必须给的

| 列 | 说明 |
| --- | --- |
| `request_id` | 关联到调用记录。**幂等键** |
| `revenue_amount` | 向用户收的钱。这是用户账单与用量趋势的收入口径 |
| `total_tokens` 与四个分项 | 与调用记录一致 |
| `created_at` | 计费时间 |

### 成本与收入分开记

这两组是分开的，谁也别拿谁算：

| 列 | 侧 | 说明 |
| --- | --- | --- |
| `cost_multiplier`、`cost_multiplier_rules`、`cost_amount` | 成本 | 付给上游的 |
| `revenue_multiplier`、`revenue_multiplier_rules`、`revenue_amount` | 收入 | 向用户收的 |

`*_rules` 是 JSON，把命中的倍率规则原样存下来，以后对账能回答「这笔为什么是 1.15 倍」。

### 归属与分成

| 列 | 说明 |
| --- | --- |
| `owner_user_id` | 上游账号的属主。平台自营为空 |
| `owner_credit_amount` | 渠道分成 |
| `user_id`、`api_key_id`、`plan_id` | 这笔算在谁头上、走的哪个套餐 |
| `channel_id`、`channel_name` | 哪个渠道 |

### 其他

`entry`、`model`、`stream`、`usage_source`、`charge_mode`、`currency`、`billing_mode`、`status`、`ledger`、`latency_ms`、`http_status`、`attempts`、`retried`。

`ledger` 说明这笔走的是订阅额度（`quota`）还是余额（`balance`）。**这个值是本机扣完费回填的**，
网关推上来的那个会被丢掉（见下「走哪个口袋由本机判」），所以网关给不给都行。

## 写入协议

**端点**：`POST /api/internal/records`

```json
{
  "records": [ { "request_id": "req_abc", "user_id": 263, "model": "gpt-4o", "status": "success", "...": "..." } ],
  "billing": [ { "request_id": "req_abc", "user_id": 263, "revenue_amount": 0.42, "...": "..." } ]
}
```

`records` 与 `billing` 都可选，也可以只给其中一个（`billing` 先到、`records` 后到是允许的）。
两个都不是数组时回 400；`records` 是空数组则什么都不做。

返回 `{ok: true, inserted, skipped, invalid}`：`inserted` 是新写进去的行数（`records` 与 `billing` 合计），
`skipped` 是被当成重复跳过的条数（含同一批里 `request_id` 重复的），`invalid` 是认不出、整条丢掉的条数。
**`skipped` 与 `invalid` 都是正常返回**，不是错误 —— 网关看到 `ok: true` 就不用重发了。

**认证**：请求头 `x-callback-secret`，不走会话。摄入与客户端密钥校验共用一把 `RECORDS_CALLBACK_SECRET`；充值回调单独一把 `RECHARGE_CALLBACK_SECRET`。两把已经拆开，互不通用（`src/lib/callback-secret.ts`），生产环境下缺任一把都会被 `scripts/check-env.ts` 在启动时拦下。没带密钥回 401，带错回 403，生产环境没配密钥回 503。

**幂等**：按 `request_id`。同一批重复提交不会记两遍，返回里的 `skipped` 是跳过的条数。

**字段宽松**：本机对字段类型很宽容 —— 数字传字符串也收（`latency_ms: "123"` 当 123），
`true`/`"true"`/`1` 都当 1，超长的 varchar 截断到列宽，超 int32 的整数那一格丢掉（只丢这一格，不丢整条），
不认识的字段名直接忽略。**唯一会让一整条作废的是缺 `request_id`**，那条计入 `invalid` 而不报错。
**这是有意为之**：日志写入不该因为一个字段格式不对就整批失败。但反过来，网关不能指望本机替它纠错，该给的字段还是要给。

**批量**：一次可以提交多行，**不设条数上限**（定案）。分批交给网关自己控制，一批几百行，配合重试。摄入端设上限就要拒绝整批，网关反而得记住哪些发过、哪些被拒，重试语义会变复杂。

**顺序**：不要求有序。`billing` 先到、`records` 后到也没关系（两者独立插入，靠 `request_id` 关联）。

**重试**：网关发失败（超时、5xx）就重发整批。重复的部分会被去重，不需要网关自己记哪些发过。

## 摄入时一并记账

扣费走这条路，已实现（`src/lib/records.ts` 的 `chargeBilling`）。网关把 `revenue_amount` 交上来，本机在同一个事务里写 `billing_records` + 一条 `credit_transactions`（`source='usage'`、`ref_id=request_id`）+ 更新 `users.balance` 与 `credit_used`，有订阅的还要累加 `subscriptions.quota_used`。复用 [src/lib/ledger.ts](../src/lib/ledger.ts) 的 `applyCreditTx`，口径与调账、订阅一致。

第三行长这样（表在 [db/init/03-business.sql](../db/init/03-business.sql)）：

| 列 | 值 |
| --- | --- |
| `user_id` | 计费行的 `user_id` |
| `delta` | `-revenue_amount`，负数表示扣款 |
| `source` | 恒为 `'usage'`。充值、调账、订阅各是别的取值，查用量扣费时按它筛 |
| `ref_id` | 那个 `request_id`。**对账的锚点**：`billing_records.request_id` 与它对得上 |
| `balance_after`、`credit_used_after` | 扣完之后的两个数，账本按 `users` 现算，只在这里留快照 |
| `balance_part`、`credit_part` | 这一笔里余额出了多少、授信出了多少，两者之和等于 `delta` |
| `ledger` | 恒为 `'balance'`（只有走余额才写流水），与 `billing_records.ledger` 一致 |
| `model`、`total_tokens` | 从计费行抄过来的，展示用 |
| `reason`、`operator`、`detail` | 用量流水这三列都是空，它们给人工调账用 |

只有走余额的那笔才写 `credit_transactions`。走订阅额度的（`ledger='quota'`）没有余额变动，
只改 `subscriptions.quota_used`，所以那种调用在账本流水里查不到 —— 想核这一笔要看 `billing_records`。
一笔调用要么写流水要么累加订阅额度，不会两边都写。

另外两条不采用：**网关直接改库**省一次 HTTP，但记账口径就分叉了（网关要自己实现「先扣余额、不够占授信」），而且绕过了本机的事务与锁；**本机扫表补记**要写补偿逻辑，还会与实时扣费抢锁。

**走哪个口袋由本机判，不看网关给的 `ledger`。** 请求体里带的 `ledger` 一律丢掉（`src/lib/records.ts:438`），由本机按用户当期的订阅余量定，再回填到 `billing_records.ledger`：

1. 有生效订阅且 `quota_kind='money'`，先吃订阅额度（`ledger='quota'`，累加 `subscriptions.quota_used`）。判定与累加合成一条 SQL，并发摄入不会把订阅额度吃超。
2. 订阅额度不够、或没有订阅、或订阅是 `requests` 档（单位是次数，收入的元没法拿去比），整笔走余额（`ledger='balance'`）。

一笔调用只落一种 `ledger`，不拆成两笔 —— 拆开之后 `billing_records` 与 `credit_transactions` 就对不上了。

**余额不够时允许透支**，与手工调账同一条路（`allowOverdraft`）。请求已经发生，记录是被动推上来的，拒绝只会丢数据。代价是 `credit_transactions.delta` 与 `billing_records.revenue_amount` 一一对应，但用户可能欠到超过授信额，转发侧要自己拦。

`revenue_amount` 就是**幂等扣费**的金额来源：扣费挂在「这一行确实新插进去」之后，与「跳过重复行」同一套判断，同一个 `request_id` 重复提交不会扣第二次。

`billing` 行的 `user_id` 为空、或该用户已被删除时，这一行照常入库，只是不扣费 —— 不因为一条脏数据把整批回滚掉。

## 已定下的写法

**一次写，不分两阶段。** 调用结束时写完整的一行，摄入保持「已存在就跳过」。两阶段本来就写不通：先写 `in_progress`，结束时再写一次会被当成重复丢掉。要用两阶段得把摄入改成 upsert（且只更新未完成的行），网关还要维护状态。代价是请求中途网关挂了，这次调用在库里没有痕迹，先接受。

**先不加重试明细表。** 只留 `attempts` 与 `retried` 两个计数，看不出「第一次打到 A 上游超时了、第二次打到 B 成功」。要查这个得加一张 attempt 子表（每次尝试一行：尝试序号、渠道、上游状态码、耗时、错误）。等真有人来问再加。

## 有意不存的

- **请求与响应的正文**（prompt、completion）。体积大、且是用户数据，不该落在控制台库里。排查靠 `error_message` 与 `upstream_message`。
- **每个 attempt 的明细**，见上面「先不加重试明细表」。
- **上游的原始响应体**。同上。

## 与转发内核的边界

本机负责：存、查、汇总、扣费。
内核负责：产生这些量、按上面的协议推过来、失败重试。

本机**不**做的事：判断该不该拦请求、算倍率、选渠道。那些都在内核侧，本机只接收结果。

## 索引

按页面实际会用的查询建的：

| 查询 | 索引 |
| --- | --- |
| 某个用户的调用记录，按时间倒序 | `idx_request_records_user (user_id, created_at)` |
| 按模型看用量趋势 | `idx_request_records_model (model, created_at)` |
| 排查失败、算成功率 | `idx_request_records_status (status, created_at)` |
| 某个用户的账单 | `idx_billing_records_user (user_id, created_at)` |
| 按渠道算成本 | `idx_billing_records_channel (channel_id, created_at)` |
| 按模型看收入 | `idx_billing_records_model (model, created_at)` |

`request_id` 上两张表都有唯一索引，既做幂等又做关联。
