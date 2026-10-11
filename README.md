# tokenmp/web

TokenMP 销售控制台的前端。栈是 SolidStart 2、Tailwind CSS v4、TypeScript，包管理器用 Bun。

界面参照线上 tokenmp.top 复刻，令牌与组件清单见 [DESIGN.md](DESIGN.md)。

## 本地数据库

控制台的用户数据放在一个本地 MySQL 里，用 docker compose 起：

```bash
sudo docker compose up -d      # 起库，映射到宿主 3307
sudo docker compose down       # 停库
sudo docker compose down -v    # 停库并清空数据
```

首次启动会按文件名顺序执行 [db/init](db/init) 下的脚本建表：`01-schema.sql` 是用户表，
`02-system.sql` 是版本、公告、通知，`03-business.sql` 是余额账本、密钥、套餐与订阅，
两个脚本末尾各带几条种子数据。

> `docker compose up` 每次都会重跑这些脚本，所以里面的 `INSERT` 都带 `WHERE NOT EXISTS`。

> 本地这个账号不在 `docker` 组里，所以命令前面得加 `sudo`。要免掉的话：
> `sudo usermod -aG docker $USER`，然后重新登录。

库里的用户是从线上搬过来的，密码哈希原样保留，所以线上账号在本地也能登录。数据来源和字段含义见 [src/lib/schema.ts](src/lib/schema.ts) 的注释。

## 登录

[src/routes/index.tsx](src/routes/index.tsx) 是登录页。登录状态存在 `tokenmp_session` 这个 httpOnly cookie 里（JWT，7 天），`/dashboard` 下的页面都要求登录，没登录会被送回登录页。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | `{email, password}`，`email` 一栏也接受用户名；返回 `{token, user}` |
| POST | `/api/auth/register` | `{email, password, name?}` |
| GET | `/api/auth/me` | 读 cookie 返回当前用户 |
| POST | `/api/auth/logout` | 清 cookie |

几处需要注意的地方：

- 密码用 bcrypt 校验。线上库里的哈希混了 `$2a$10$`、`$2b$10$`、`$2y$12$` 三种前缀（`$2y$` 是 PHP 那套的风格），bcryptjs 三种都能验，已逐条确认。
- 会话是无状态 JWT，改密码后靠 `users.token_version` 把旧会话顶掉。
- 接口形状是照着线上 Go 后端拄的（`/auth/login` 返回 `{token, user}`）。
- 线上注册要先调 `/auth/send-code` 发邮箱验证码，本地没有邮件服务，注册接口直接建账号，只适合开发环境用。

## 开发

```bash
bun install
bun run dev
```

开发服务器绑定 `0.0.0.0:6789`，本机和同一局域网的其他设备都能打开，局域网地址用 `hostname -I` 里的那个。

| 场景 | 地址 |
| --- | --- |
| 本机 | `http://localhost:6789` |
| 局域网其他设备 | `http://<本机局域网 IP>:6789` |

新增或删除 `src/routes/` 下的文件后要重启开发服务器。文件监听会刷新页面，但不会重新生成路由表。

### 测试

用 `bun test`，没引额外框架。三层，各有各的用处：

| 文件 | 打什么 | 跑法 |
| --- | --- | --- |
| [tests/api.test.ts](tests/api.test.ts) | 直接调路由的 handler，不经过 HTTP | `bun test` |
| [tests/routes.test.ts](tests/routes.test.ts) | 路由文件结构：每个页面能否被解析出默认导出 | `bun test` |
| [tests/deploy-flow.ts](tests/deploy-flow.ts) | 跑起来的生产构建，走真实注册、登录与 cookie | 见下 |
| [tests/ui-flow.ts](tests/ui-flow.ts) | 真浏览器，测点开又取消、切来切去 | 见下 |
| [tests/ui-pages.ts](tests/ui-pages.ts) | 真浏览器，逐页验证「读的是数据库不是写死的假数据」 | 见下 |
| [tests/deploy-mutations.ts](tests/deploy-mutations.ts) | 变异输入：类型错位、边界值、注入、越权、并发、中断 | 见下 |

后四个要先起服务：

```bash
bun run build
bun run start &

bun tests/deploy-flow.ts      # 整套业务链路
bun tests/ui-flow.ts          # 浏览器交互
bun tests/ui-pages.ts         # 逐页接线
bun tests/deploy-mutations.ts # 变异
```

六个都需要本地库在跑。每个用例自己建测试数据，命名带时间戳，跑完只删自己的，
可以反复跑。

tests/ui-pages.ts 的做法值得一提：它先用接口造一条带唯一标记的数据（一个用户、一个套餐、
一把密钥），再用浏览器打开对应页面找这条标记。标记出现就说明页面读的是数据库；
同时断言那些写死的模拟数据（如 `lin.zy@example.com`）不再出现。
比断言 DOM 结构稳定得多。

tests/routes.test.ts 是被一个真实故障逼出来的：`src/routes/panel/me.tsx` 里写了
`export default function PanelMe() {}`，oxc-parser 把它误判成**类型导出**，
而 SolidStart 的路由扫描会把 `isType` 的条目过滤掉 —— 这个页面于是直接 404，
构建日志里一句警告都没有。这条测试用同一个解析器盯住所有路由文件的结构。

tests/ui-flow.ts 用 Playwright（devDependency），浏览器已缓存在 `~/.cache/ms-playwright`。

### 不起服务器调接口

会话是无状态 JWT，所以调单个接口时不用走登录流程，也不用去猜库里那几个管理员账号的密码。
[scripts/dev-token.ts](scripts/dev-token.ts) 按 `SESSION_SECRET` 签一个管理员会话：

```bash
bun scripts/dev-token.ts          # 挑一个可用的管理员
bun scripts/dev-token.ts 319      # 指定用户 id
bun scripts/dev-token.ts --curl   # 顺带打印一条 curl 命令
```

或者在测试里直接把 handler 拿来调，给一个带 cookie 的 `Request` 就行：

```ts
const request = new Request("http://localhost:6789/api/admin/users", {
  headers: { cookie: `tokenmp_session=${token}` },
});
const res = await GET({ request } as never);
```

这样不用一个用例起一次服务器，也不会和别的进程抢 6789。脚本结尾要写 `process.exit(0)`，
否则 `db` 的连接池会让进程一直挂着。

装依赖走本机的 mihomo 代理会快很多，直连 `registry.npmjs.org` 只有百来 KB/s。

```bash
with-proxy bun install
```

## 构建

```bash
bun run build     # 产出到 .output
bun run start     # 运行生产构建
```

`start` 前面会自动跑 `prestart`，也就是 [scripts/check-env.ts](scripts/check-env.ts)：
先查 `SESSION_SECRET`、`DATABASE_URL`、数据库能不能连上、建表脚本跑过没有，
缺什么就当场退出并说清楚。这一道是补上来的 —— 之前用 `NODE_ENV=production` 起服务时，
进程正常监听、日志里一句提示都没有，直到有人点登录才 500，报「生产环境必须设置 SESSION_SECRET」。
根因是 node 不读 `.env`，所以启动命令里带了 `--env-file-if-exists=.env`（文件不存在也不报错，
适合用 systemd 或容器注入环境变量的场合）。

生产上至少要把 `SESSION_SECRET` 换掉，`.env.example` 里有说明。

## 系统级的版本、公告、通知

三者的分工：

| | 面向 | 存在哪 | 用户能做什么 |
| --- | --- | --- | --- |
| 版本 | 所有人 | `system_config.system_version` | 在页脚看到版本号 |
| 公告 | 全站 | `announcements` | 看到；标了可关闭的能关掉，关过的记在 `announcement_dismissals` |
| 通知 | 单个用户 | `notifications` | 看到、标已读、点动作按钮 |

字段照着线上 postgres 的 `announcements` / `notifications` / `user_release_reads` 定，
只把主键从 uuid 换成 bigint 以对齐本地 users 表。线上「v0.1.0 正式发布」本身就是一条公告，
所以版本说明没另建表 —— 发布说明按公告发就行，不必多一套机制。

建表脚本在 [db/init/02-system.sql](db/init/02-system.sql)。

接口：

| 路径 | 说明 |
| --- | --- |
| `GET /api/system/version` | 公开，前端显示版本号 |
| `GET /api/announcements` | 公开，返回生效中的公告；登录后带 `dismissed` |
| `POST /api/announcements/{id}/dismiss` | 关掉一条公告 |
| `GET /api/notifications` | 我的通知，带未读数 |
| `POST /api/notifications/{id}/read` | 标为已读（幂等） |
| `POST /api/notifications/read-all` | 全部已读 |
| `GET/POST /api/admin/announcements` | 管理员：列表（含草稿）、新建（默认草稿） |
| `GET/PATCH/DELETE /api/admin/announcements/{id}` | 管理员：详情、改、删 |
| `POST /api/admin/announcements/{id}/publish` 与 `/archive` | 管理员：发布、归档 |
| `GET/POST /api/admin/notifications` | 管理员：投递记录、发通知（支持批量与幂等键） |

两个设计上的选择：新建公告出来的是**草稿**，发布是单独的动作，免得点一下保存就把公告推给全站；
发通知带 `idempotency_key` 时按它去重，批量发会在键后接上用户 id，
否则所有人共用一个键、只有第一个收得到。

### 界面

| 东西 | 出现在哪 | 前端文件 |
| --- | --- | --- |
| 版本 | 桌面端侧边栏底部、移动端「更多」抽屉末尾 | [app-shell.tsx](src/components/layout/app-shell.tsx) 的 `VersionLabel` |
| 公告 | 控制台内容区顶部与登录页顶部，按级别着色，可关闭 | [announcement-banner.tsx](src/components/layout/announcement-banner.tsx) |
| 通知 | 顶栏铃铛，带未读数，点开是最近 20 条 | [notification-bell.tsx](src/components/layout/notification-bell.tsx) |
| 公告管理 | `/dashboard/announcements` | [announcements.tsx](src/routes/dashboard/announcements.tsx) |

数据走 [src/lib/system.ts](src/lib/system.ts)，都是同源的 `fetch`，形状与
[openapi.yaml](openapi.yaml) 一致（snake_case）。没用 `createResource`：它在 SSR 阶段也会执行，
而服务端对相对路径的 `fetch` 会抛 `Failed to parse URL`，所以统一用
[src/lib/resource.ts](src/lib/resource.ts) 的 `createClientResource`，挂载到浏览器后再取。
代价是首帧没有内容 —— 公告条会晚一拍出现。

几个实现上的选择：

- 公告条关掉是先收起来再发请求。未登录时 `POST /api/announcements/{id}/dismiss` 返回 401，
  这时退回 `localStorage` 记一笔，登录用户则由服务端记（换台设备也不会重新弹）。
- 初始化脚本里带了一条公告和一条欢迎通知作种子，新起的库一登录就能看到两处的样子。
  两条都写了 `WHERE NOT EXISTS` —— `docker compose up` 每次都会重跑 `db/init` 下的脚本。
- 通知的已读是乐观更新：先改本地，失败再整份重拉。接口本身幂等，重试不会出错。
- 公告管理页的列表把草稿和归档的也算上，筛选在本地做（一次请求拿回整份列表）。
  行内一个按钮兼顾发布与归档：草稿和归档过的点「发布」，已发布的点「归档」。

通知的管理端（给指定用户发通知）没做界面：接口要 `user_id`，虽然用户列表接口已经有了，
但页面还是示例数据，界面上拿不到真实 id。等用户列表页接上真实数据再补。

## 业务接口

用户管理、余额账本、API 密钥、套餐与订阅四组接口已落地，字段与线上一致。
本机跟线上的差异与本机自己加的字段，都记在 [openapi.yaml](openapi.yaml) 的「两处差异」
与「本机扩展」两节里，不在代码里另找。

建表在 [03-business.sql](db/init/03-business.sql)：`users` 加了 `balance` 与 `credit_used` 两列，
另建 `user_budgets`、`api_keys`、`credit_transactions`、`plans`、`plan_prices`、`subscriptions`
六张表，种子里有五档套餐。

| 组 | 接口 |
| --- | --- |
| 用户管理 | `/api/admin/users` 增删改查、`/api/admin/users/{id}/budget` 预算封顶 |
| 余额账本 | `/api/admin/balances/adjust` 调账与代充、`/api/admin/adjust-logs`、`/api/user/credits`、`/api/user/me` |
| API 密钥 | `/api/user/api_keys` 自助三支，`/api/admin/users/{id}/api_keys` 与 `/api/admin/api_keys/{id}` 管理端 |
| 套餐与订阅 | `/api/admin/plans` 与 `/api/admin/plan_prices/{id}` 定价，`/api/admin/plan-activations*` 激活统计，`/api/user/plans` 与订阅 |

充值走管理员代充，就是调账接口带 `source: "recharge"`，没有自助支付渠道。

### 账本口径

账户上有三个量，语义与 openapi 对齐：

```
已用信用 = credit_limit - credit_available
可用额度 = balance + credit_available
```

`credit_available` 不落库，每次由 `credit_limit` 与 `credit_used` 现算，免得三个数各写各的。
记账只有一处实现（[src/lib/ledger.ts](src/lib/ledger.ts)），调账、代充、订阅、
将来转发侧的用量扣费都走它：

- 入账（正数）先冲抵已用的信用额度，剩下的才进余额。
- 扣款（负数）先扣余额，不够再占信用额度。
- 调账允许透支，管理动作不该被余额拦住；订阅用同一套逻辑但不允许，不够就回 402。

整个动作在一个事务里，先 `SELECT ... FOR UPDATE` 锁住用户行，两个人同时给一个用户调账
不会丢更新。订阅在同一个事务里做完扣款、写订阅、改 `plan_id` 三件事。

### 几个取舍

密钥只存 sha256，明文只在签发那一次返回，之后只能看前缀和末 6 位。

没给密码建号时用随机串的哈希占位，账号立起来但登录不了；管理员之后改密码时会同时把
`token_version` 加一，已经签发的会话当场失效。

管理端接口的鉴权用 [api-auth.ts](src/lib/api-auth.ts) 的 `guardAdmin`：未登录回 401、
非管理员回 403。早先的公告与通知路由用的是 `requireAdmin`，两种情况都回 403，还没改过来。

续费就是再订一次：再扣一次钱，多一行订阅记录，老的那行留着当历史。
当前订阅取「`active` 且 `period_end` 最晚」那条；提前续费时两行都是 `active`，
两份额度怎么合并扣减属于转发侧的事，这次没做。

这四组接口还没接前端页面。接口已就绪但页面仍读示例数据的有八页：`/dashboard` 下的用户、
余额、密钥、套餐四页与 `/panel` 下的密钥、积分、套餐、个人中心四页，把数据源换成 `fetch` 即可。

另有十一页连后端都没有，它们依赖的 71 个端点在 openapi.yaml 里标的是 `remote`（渠道、计费、
模型目录、共享账号、平台设置等），要先等转发侧或本机补齐实现。逐条清单与依据见
[功能缺口清单](docs/gaps.md)。

## 接口文档

[openapi.yaml](openapi.yaml) 描述后端接口，同时盖两套东西：

- **线上**（`https://tokenmp.top`，Go + echo）：管理端 `/admin/*` 与认证 `/auth/*`，另含用户端 `/user/*`。
  字段名、查询参数、错误码都是从线上源码里逐处对应出来的。
- **本机**（SolidStart）：只落地了认证那一组。

每个操作带一个 `x-implemented` 标记：`local` 表示本机已实现，`remote` 表示只在线上。
两边不同步的地方（注册要不要验证码、错误信封长什么样、分页参数叫什么）都写在文档开头的
说明里，不用对着两份代码找差异。

校验：

```bash
bunx @redocly/cli lint openapi.yaml
```

规则配置在 [redocly.yaml](redocly.yaml)，关掉了「服务器地址不能是 localhost」
（本机后端就是 localhost），并把「每个操作都要写 4xx」降成提示而不是错误。

## 用户面板

线上那套是 React 写的（页面在它的 `src/pages/panel/`），本地这份按同样的信息架构重写成 Solid：
十个页面、分组侧栏、手机端底栏。数据全部是示例数据（放在 [src/lib/panel-data.ts](src/lib/panel-data.ts)），
字段名照 [openapi.yaml](openapi.yaml) 里 `UserPanel` 那组端点，接后端时把数据源换成 fetch 就行。

跟控制台（`/dashboard`）的几处差别：

| | 控制台 | 用户面板 |
| --- | --- | --- |
| 侧栏 | 平铺十项 | 分四组（模型与密钥 / 数据 / 财务 / 账户） |
| 断点 | `lg`（1024px） | `md`（768px）：平板上也该用侧栏 |
| 手机底栏 | 四项加「更多」 | 五项（概览 / 密钥 / 模型 / 请求 / 我的） |
| 金额单位 | 美元 | 积分（1 元 = 10000 积分） |
| 列表 | 窄屏横向滚动 | 桌面表格 / 手机卡片流（`ResponsiveTable`） |

单位不一致是跟着各自线上版本走的，不是随手写的：线上两套界面一个用 ¥/积分，一个用 $。
接真实数据时应该统一，控制台那边改 `formatCurrency` 的调用即可。

本机为了少引基础组件做的取舍，都记在这里：

- **筛选**：模型改成下拉（[ui/select.tsx](src/components/ui/select.tsx)），线上的模型 / User Agent
  是**可搜索**下拉，本机这两个还是「搜索框 + 模型下拉 + 状态分段」—— 可搜索下拉等真有需要再给 Select 加。
- **分页**：线上手机端是「卡片流 + 加载更多」，本机桌面手机共用一套分页条（每页条数也是下拉）。
- **套餐订阅**：线上由管理员切换，本机做了确认流程，但没接支付。
- **模型目录**：线上还有倍率规则、阶梯计价这些销售侧配置，用户面板里只留了参考价。

## 布局

桌面端用左侧固定侧边栏装下全部导航，顶栏右上角是账户菜单（身份信息、主题切换、退出登录）。

移动端不用抽屉 —— 抽屉要先点开汉堡、找到目标、再关掉，去一个常用页面得走三步。改成底部导航：四个最常点的（概览、用户、余额、计费）加一个「更多」，其余入口收在「更多」的底部抽屉里。十项塞不进底栏，所以只挑常用的，账户菜单同样在右上角。

几个跟着来的细节：底部导航固定占 64px，正文要留 pb-24，否则最后一行会被压住；底栏和顶栏都加了 safe-area padding，iPhone 的底部手势条不会盖住导航；指标行在手机上用两列，单列会把四张卡铺满一整屏。

## Solid 的一个坑

props 上的字段是惰性 getter。同一个 JSX 类型的 prop 在一处读两遍，比如 `<Show when={props.children}>` 判断一次、渲染时再取一次，会让同一批 JSX 元素被求值两遍并创建成两个实例。Solid 只允许一个元素实例挂到 DOM 上，第二次插入就让整个页面报 `template is not a function` 然后一片空白，控制台里的报错还只在某个微任务里出现，现象看着像随机。

页头、指标行、弹窗这三个共享组件都踩了这个坑：前两个读了两遍 children，弹窗里 `props.footer ?? 默认值` 加上 `<Show when={props.children}>` 也是两遍。因为分享件，一开始看上去像是那几个用到了共享件的页面各自出了毛病，跟图标、缓存、HMR 都不相关。现在都改成只读一遍，八个页面跟生产构建都正常。

要给子组件传 JSX 时，用 `children(() => props.children)` 求值一次并把结果缓存住，或者安排每个 JSX prop 只在一个地方出现。

## 目录

| 路径 | 内容 |
| --- | --- |
| [src/routes](src/routes) | 文件路由：`index.tsx` 登录页、`dashboard.tsx` 控制台、`panel.tsx` 用户面板、`api/` 接口 |
| [src/components/ui](src/components/ui) | 基础组件，shadcn/ui 写法 |
| [src/components/layout](src/components/layout) | 两套外壳、公告条、通知铃铛、页头 |
| [src/components/panel](src/components/panel) | 面板专用：响应式列表、用量图、详情行 |
| [src/store](src/store) | 外观偏好 |
| [src/lib](src/lib) | 类名合并、数字与时间格式化、数据库连接、认证、系统级数据（`system.ts`） |
| [docker-compose.yml](docker-compose.yml) | 本地开发用的 MySQL |
| [db/init](db/init) | 建表脚本，容器首次启动时执行 |
