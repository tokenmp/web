# TokenMP 销售控制台功能缺口清单

## 现状

本机后端按 [接口定义](openapi.yaml) 落地了 47 个 `x-implemented: local` 端点，分六组：

- 认证 4 个（注册、登录、登出、当前用户）
- 系统 14 个（版本、公告、通知，以及管理端公告 CRUD 与通知投递）
- 用户管理 10 个（`/admin/users` 的增删改查、预算、密钥、吊销）
- 余额账本 2 个（`/admin/balances/adjust`、`/admin/adjust-logs`）
- 套餐与订阅 10 个（`/admin/plans*`、`/admin/plan-activations*`）
- 用户面板 7 个（`/user/api_keys*`、`/user/credits`、`/user/plans*`、`/user/me`）

另有 71 个 `x-implemented: remote` 端点只存在于线上（渠道、计费、概览、模型目录、共享账号、平台设置、网关）。

前端有控制台十个页面与用户面板十个页面。真正调用后端的只有 [公告管理页](src/routes/dashboard/announcements.tsx)，
加上三个布局组件的系统数据：[顶栏版本号](src/components/layout/app-shell.tsx)、
[公告横幅](src/components/layout/announcement-banner.tsx)、[通知铃铛](src/components/layout/notification-bell.tsx)，
以及登录注册页的认证接口。其余业务页面全部读内联常量或 [用户面板示例数据](src/lib/panel-data.ts)。

## 一、整体阻断项

整体阻断项的判断是对的，但页数不对。不是「用户面板八个页面与控制台四个页面」，
而是控制台九个页面、用户面板十个页面都在用写死的模拟数据。接口就绪但没接前端的是其中八页，
README 第 251 行只数了这八页。剩下十一页连本机后端都没有，接也接不上。

先看哪些页面调了接口，依据是对 `src` 目录做 `import` 与 `fetch(` 检索，
只有下面这些文件出现 `~/lib/system`、`~/lib/resource` 或 `fetch`：

| 文件 | 调用的接口 | 性质 |
| --- | --- | --- |
| [index.tsx](src/routes/index.tsx) | `/api/auth/login`、`/api/auth/register` | 已接 |
| [dashboard/announcements.tsx](src/routes/dashboard/announcements.tsx) | `/api/admin/announcements*` | 已接 |
| [announcement-banner.tsx](src/components/layout/announcement-banner.tsx) | `/api/announcements`、`/api/announcements/{id}/dismiss` | 已接 |
| [notification-bell.tsx](src/components/layout/notification-bell.tsx) | `/api/notifications*` | 已接 |
| [app-shell.tsx](src/components/layout/app-shell.tsx) | `/api/system/version`、`/api/auth/logout` | 已接 |
| [panel-shell.tsx](src/components/layout/panel-shell.tsx) | `/api/auth/logout` | 已接 |
| [session.ts](src/lib/session.ts) | 直接验会话 cookie，不调 `/api/auth/me` | 绕过接口 |

控制台十个页面：

| 页面 | 应有的数据源 | 现状 |
| --- | --- | --- |
| 概览 [index.tsx](src/routes/dashboard/index.tsx) | `/admin/dashboard/*`（remote） | 内联示例，第 10 行注明 |
| 用户 [users.tsx](src/routes/dashboard/users.tsx) | `/admin/users*`（local） | 内联示例，第 25 行注明 |
| 余额 [balances.tsx](src/routes/dashboard/balances.tsx) | `/admin/balances/adjust`、`/admin/adjust-logs`（local） | 内联示例，第 40 行注明 |
| API 密钥 [api-keys.tsx](src/routes/dashboard/api-keys.tsx) | `/admin/users/{id}/api_keys`、`/admin/api_keys/{id}`（local） | 内联示例，操作用本地 state |
| 套餐 [plans.tsx](src/routes/dashboard/plans.tsx) | `/admin/plans*`、`/admin/plan-activations*`（local） | 内联示例，第 13 行注明 |
| 计费 [billing.tsx](src/routes/dashboard/billing.tsx) | `/admin/billing_records`、`/admin/request_records`（remote） | 内联示例，第 22 行注明 |
| 渠道 [channels.tsx](src/routes/dashboard/channels.tsx) | `/admin/channel-groups*`（remote） | 内联示例，第 19 行注明 |
| 渠道分组 [channel-groups.tsx](src/routes/dashboard/channel-groups.tsx) | 同上（remote） | 内联示例，第 22 行注明 |
| 渠道申请 [channel-applications.tsx](src/routes/dashboard/channel-applications.tsx) | `/admin/channel-applications*`（remote） | 内联示例，第 24 行注明 |
| 公告 [announcements.tsx](src/routes/dashboard/announcements.tsx) | `/api/admin/announcements*`（local） | 已接 |

用户面板十个页面全部读 [panel-data.ts](src/lib/panel-data.ts)。其中概览与个人中心用 `getCurrentUser`
取真实身份（昵称、角色、主题），余额、额度、预算、流水这些业务数字仍是示例。

因为业务页面全部没接，所以「点击操作」这条路整体不通：按钮要么没有 `onClick`，要么只改本地数组。
这是第一层阻断。

第二层阻断更靠底层：五个控制台页面与六个用户面板页面依赖 remote 端点，
本机没有对应的表与路由。渠道没有表，用量与调用日志也没有（[03-business.sql](db/init/03-business.sql) 第 3 行写明
「转发产生的用量与调用日志另有表，等网关那侧把数据送过来再建」）。
这些页面即使接前端也拿不到数据，要等转发内核回写或本机补齐实现。

## 二、A 类缺口：接口有、界面没接

下面每组都按「后端端点 → 页面文件 → 缺的交互」列。端点全部是 `x-implemented: local`，本机路由已存在。

### 用户管理

| 能力 | 后端端点 | 页面 | 界面上缺的交互 |
| --- | --- | --- | --- |
| 用户列表 | `GET /api/admin/users` | [users.tsx](src/routes/dashboard/users.tsx) | 表格读内联 `users` 常量，没发请求 |
| 新建用户 | `POST /api/admin/users` | users.tsx 第 227 行 | 「新增用户」按钮没有 `onClick` |
| 用户详情 | `GET /api/admin/users/{id}` | users.tsx 第 293 行 `UserDetailSheet` | 抽屉读列表里的示例字段，没请求详情接口 |
| 改用户 | `PUT /api/admin/users/{id}` | users.tsx | 没有编辑入口，改名字、邮箱、密码、角色、授信额度、套餐都做不到 |
| 禁用用户 | `DELETE /api/admin/users/{id}` | users.tsx 第 297 行抽屉 | 没有「禁用」按钮。接口把 `status` 置 0，属于软删 |
| 启用用户 | `PUT /api/admin/users/{id}` `status=1` | users.tsx | 没有「启用」按钮。禁用后无法在界面上恢复 |
| 设预算 | `PUT /api/admin/users/{id}/budget` | users.tsx | 没有预算入口，`enabled`、`amount`、`period` 都填不了 |
| 用户密钥列表 | `GET /api/admin/users/{id}/api_keys` | users.tsx 抽屉 | 抽屉里没有该用户的密钥区块 |
| 给用户签密钥 | `POST /api/admin/users/{id}/api_keys` | [api-keys.tsx](src/routes/dashboard/api-keys.tsx) 第 180 行 | 「新建密钥」弹窗没有选用户，也没发请求，明文没地方显示 |
| 吊销密钥 | `DELETE /api/admin/api_keys/{id}` | api-keys.tsx 第 257 行 | 「停用」只把本地状态改成已停用 |

### 余额账本

| 能力 | 后端端点 | 页面 | 界面上缺的交互 |
| --- | --- | --- | --- |
| 调账 | `POST /api/admin/balances/adjust` `source=adjust` | [balances.tsx](src/routes/dashboard/balances.tsx) | 只有「充值」弹窗，没有调账（扣款、改授信）入口 |
| 代充 | `POST /api/admin/balances/adjust` `source=recharge` | balances.tsx 第 228 行 | 「充值」弹窗写了金额却没有提交动作 |
| 批量充值 | 同上，逐笔调用 | balances.tsx 第 169 行 | 「批量充值」弹窗第 177 行直接写「这个动作还没有接后端接口」 |
| 调账记录 | `GET /api/admin/adjust-logs` | 无页面 | 没有调账流水列表，`user_id`、`operator`、`direction`、`ref` 这些筛选参数没有任何界面 |

### 套餐与订阅

| 能力 | 后端端点 | 页面 | 界面上缺的交互 |
| --- | --- | --- | --- |
| 套餐列表 | `GET /api/admin/plans` | [plans.tsx](src/routes/dashboard/plans.tsx) | 卡片读内联 `plans` 常量 |
| 新建套餐 | `POST /api/admin/plans` | plans.tsx 第 96 行 | 「新建套餐」按钮没有 `onClick` |
| 看已删套餐 | `GET /api/admin/plans?status=all` | plans.tsx | 没有「含已停用」开关 |
| 套餐详情 | `GET /api/admin/plans/{id}` | plans.tsx | 卡片上没有进详情的入口，模型价看不到 |
| 改套餐 | `PUT /api/admin/plans/{id}` | plans.tsx 第 142 行 | 「编辑」按钮没有 `onClick` |
| 删套餐 | `DELETE /api/admin/plans/{id}` | plans.tsx 第 145 行 | 「停用」按钮没有 `onClick` |
| 加模型价 | `POST /api/admin/plans/{id}/prices` | plans.tsx | 没有模型价编辑界面 |
| 删模型价 | `DELETE /api/admin/plan_prices/{id}` | plans.tsx | 同上 |
| 订阅概览 | `GET /api/admin/plan-activations/summary` | 无页面 | 订阅数、月收入、周激活、七天内到期四个数字没有展示 |
| 订阅列表 | `GET /api/admin/plan-activations` | 无页面 | 没有按用户聚合的激活列表，`plan_id`、`expire=7d/expired` 筛选用不上 |
| 用户续费历史 | `GET /api/admin/plan-activations/{user_id}/history` | 无页面 | 没有单个用户的续费记录 |

### 用户面板

| 能力 | 后端端点 | 页面 | 界面上缺的交互 |
| --- | --- | --- | --- |
| 我的密钥 | `GET /api/user/api_keys` | [keys.tsx](src/routes/panel/keys.tsx) | 列表读 `panel-data` 的 `apiKeys` |
| 新建密钥 | `POST /api/user/api_keys` | keys.tsx 第 76 行 | `create()` 自己拼前缀与后缀，明文是假的，没发请求 |
| 删密钥 | `DELETE /api/user/api_keys/{id}` | keys.tsx 第 99 行 | `remove()` 只过滤本地数组 |
| 额度与流水 | `GET /api/user/credits` | [credits.tsx](src/routes/panel/credits.tsx) | 读 `panelCredits` 与 `balanceTransactions` |
| 可订阅套餐 | `GET /api/user/plans` | [plans.tsx](src/routes/panel/plans.tsx) | 读 `planViews` 与 `currentPlan` |
| 订阅与续费 | `POST /api/user/plans/{id}/subscribe` | plans.tsx 第 65 行 | `subscribe()` 只 `setSubscribed`，第 78 行与第 315 行还写着「没有真的下单」「本机没有接支付与订阅接口」，与接口已实现不符 |
| 我的账号信息 | `GET /api/user/me` | [me.tsx](src/routes/panel/me.tsx) | 余额、授信、预算读 `panelMe`，没调接口 |

### 系统与认证

| 能力 | 后端端点 | 页面 | 界面上缺的交互 |
| --- | --- | --- | --- |
| 公告详情 | `GET /api/admin/announcements/{id}` | [announcements.tsx](src/routes/dashboard/announcements.tsx) | 列表已带全字段，没有页面调用，属于冗余 |
| 通知投递列表 | `GET /api/admin/notifications` | 无页面 | 没有投递记录界面 |
| 发通知 | `POST /api/admin/notifications` | 无页面 | 没有给用户发通知的入口 |
| 当前登录用户 | `GET /api/auth/me` | 无页面 | [session.ts](src/lib/session.ts) 直接验 cookie，接口没人用 |

## 三、B 类缺口：接口也没有的能力

分两类。第一类是接口定义里根本没有这个操作，属于真缺口；
第二类是 `openapi.yaml` 里定义过但标 `remote`，本机没有实现，对应页面拿不到数据源。

### 接口定义里就没有的操作

- 订阅取消与退订。
  `openapi.yaml` 的 `/user/plans*` 只有 `GET /user/plans` 与 `POST /user/plans/{id}/subscribe`（第 4147、4182 行），
  没有任何 cancel 操作。`subscriptions.status` 只有 `active` 与代码里写的 `expired`（[03-business.sql](db/init/03-business.sql) 第 171 行）。
  管理员也退不了：`PUT /admin/users/{id}` 传 `plan_id: null` 只改 `users.plan_id`（[users/[id].ts](src/routes/api/admin/users/[id].ts) 第 188 行），
  订阅行仍是 `active`。用户订了只能等周期结束。
- 退款。
  没有任何退款端点。`credit_transactions.source` 的取值是 `recharge`、`adjust`、`usage`、`channel_share`、`subscription`（03-business.sql 第 79 行），
  没有反方向的退款类型。管理员可以用 `adjust` 手工加钱，但那不是一张退款单，对不上原订阅。
- 套餐升级与降级。
  `openapi.yaml` 没有 upgrade 或 downgrade 操作。唯一的换套餐方式是再订阅一次：
  [subscribe.ts](src/routes/api/user/plans/[id]/subscribe.ts) 第 20 行写明「续费就是再点一次：每次都新写一行」，
  第 58 行按新套餐价格整额扣款，没有按剩余周期折算。所以从月付换到更高档会再扣一次全款。
- 改进已有的密钥。
  `/user/api_keys/{id}` 只有 `DELETE`（openapi.yaml 第 3494 行），`/admin/api_keys/{id}` 也只有 `DELETE`（第 1630 行）。
  [api_keys 表](db/init/03-business.sql) 有 `model_whitelist` 与 `rate_limit_per_min` 两列（第 66、67 行），
  没有读写接口。改名、改过期时间、改白名单、改限速都做不到，只能删了重建。
- 单独禁用一把密钥。
  `api_keys.status` 有列（第 65 行），但没有任何接口把它置 0。
  第 64 行注释写明「删是硬删，这个字段留给网关那边标记失效」，
  删除接口确实是物理删除（[api_keys/[id].ts](src/routes/api/admin/api_keys/[id].ts) 第 17 行）。
- 用户自己改密码。
  `POST /auth/password` 在 `openapi.yaml` 第 1364 行有定义，标的是 `x-implemented: remote`。
  本机 [src/routes/api/auth](src/routes/api/auth) 只有 login、logout、me、register 四个文件，没有 password。
  管理员能在 `PUT /admin/users/{id}` 里设密码，用户自己不行。
- 忘记密码与邮箱验证码。
  `POST /auth/send-code` 也是 remote（openapi.yaml 第 1202 行），本机注册不需要验证码。
- 管理员按邮箱搜用户。
  `GET /api/admin/users` 的 `keyword` 只匹配用户名：
  [users.ts](src/routes/api/admin/users.ts) 第 146 行是 `like(users.name, ...)`，
  openapi.yaml 第 1415 行也写「按用户名模糊匹配」。
  界面占位符却写的是「按邮箱搜索」（[users.tsx](src/routes/dashboard/users.tsx) 第 211 行），承诺了后端没有的能力。
- 用户自助充值与支付渠道。
  openapi.yaml 没有下单或支付操作。充值只有管理员代充一条路，
  即 `POST /admin/balances/adjust` 的 `source=recharge`（本机扩展，openapi.yaml 第 63 行）。
- 注册开关与邮箱验证。
  注册接口开放且不校验邮箱（`openapi.yaml` 第 1233 行，本机 [register.ts](src/routes/api/auth/register.ts)）。
  这更像有意的运营选择，不是缺陷，列在这里备查。

### 接口定义了但本机没实现（remote）

这些端点在 `openapi.yaml` 里都有，标 `remote`，本机没有表也没有路由，页面因此没有数据源。

| 缺的实现 | remote 端点范围 | 受影响页面 |
| --- | --- | --- |
| 用量、请求记录、账单 | `/user/usage`、`/user/request_records*`、`/user/billing_records` | 用户面板概览、请求记录、账单 |
| 管理端计费与概览 | `/admin/dashboard/*`、`/admin/billing_records*`、`/admin/request_records*`、`/admin/billing/reconciliation*` | 控制台概览、计费 |
| 渠道与网关 | `/admin/channel-groups*`、`/admin/channel-accounts*`、`/admin/channels-consistency`、`/admin/upstream-models`、`/admin/gateway/*` | 控制台渠道、渠道分组 |
| 渠道申请 | `/admin/channel-applications*`、`/user/channel-applications*`、`/user/account-groups`、`/user/channel-groups/{id}` | 控制台渠道申请、用户面板渠道 |
| 模型目录与分成 | `/admin/models*`、`/admin/model-share-rates*`、`/admin/price-check/*`、`/user/catalog` | 用户面板模型目录 |
| 共享账号 | `/user/accounts*`、`/admin/share-accounts*` | 用户面板账号 |
| 自动降级链 | `/user/auto-chain` | 无页面 |
| 平台设置与错误规则 | `/admin/platform-settings`、`/admin/error_rules*` | 无页面 |
| 健康探针 | `/healthz`、`/readyz` | 本机用 SolidStart 自带启动方式，可能有意不做 |

### 本仓库无法核实的项

预算只存不执行。`user_budgets` 有表、有接口，判定的位置在转发内核那侧，
[03-business.sql](db/init/03-business.sql) 第 36 行写明「存储与展示在本地，判定在网关侧」。
本仓库没有任何按预算拦截请求的代码，转发内核在另一个仓库，
所以「预算现在是否真的拦住请求」在本仓库里查不出来，只有接上网关后才好确认。

## 四、按优先级排序的修复建议

### 阻断

先接八个页面，把接口就绪的那部分变成可点。
具体是控制台的用户、余额、套餐、API 密钥四页，与用户面板的密钥、积分、套餐、个人中心四页。
理由：这四组接口是本机唯一完整落地又没接前端的部分，
按钮、弹窗、确认流程都已经做好，只差把数据源从常量换成 `fetch`。做完这步，控制台才第一次能改数据。

然后补用户自助改密码，即本机实现 `POST /auth/password`。
理由：现在管理员建号后，用户拿到密码就再也改不了，安全上说不通。它只有十几行逻辑，却卡住整个开号流程。

再让管理员能按邮箱搜用户。
两条路选一条：后端把 `keyword` 扩成同时匹配 `users.name` 与 `users.email`，
或者先把界面占位符从「按邮箱搜索」改成「按用户名搜索」。前者更对，后者更省事。

### 重要

订阅取消与退款。
理由：用户订了退不掉，出问题只能管理员手工 `adjust` 补钱，账目对不上。要加结束订阅的动作，以及一条退款流水。

密钥单独禁用与密钥属性编辑。
理由：现在停用一把泄露的密钥只能硬删，删了就查不到历史；改名与改限速也没有入口。表里两列已经预留，补接口即可。

套餐升级与降级，含按剩余周期折算。
理由：现在的换套餐等于再买一次，用户从一个档位换到另一个档位会被扣两次全款，这是投诉高发点。

用户自助充值。
理由：没有支付渠道，所有充值都压到管理员头上，规模一大就撑不住。可以先接一个渠道，不必一次做全。

### 次要

接用量与账单数据源。
理由：它依赖转发内核先把数据回写、本机建表，不是前端能单独推进的，排在业务闭环之后。

补管理端的公告详情与通知投递界面。
理由：接口已经实现，但公告列表已带全字段，通知投递用得也少，属于锦上添花。

清理没人调用的接口与过期文案。
`GET /api/auth/me` 没有页面用；[panel/plans.tsx](src/routes/panel/plans.tsx) 第 315 行还写着「本机没有接支付与订阅接口」，
与 `POST /user/plans/{id}/subscribe` 已实现相矛盾，接前端时顺手改掉。
