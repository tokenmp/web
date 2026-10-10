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
`02-system.sql` 是版本、公告、通知，末尾附带几条种子数据。

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

装依赖走本机的 mihomo 代理会快很多，直连 `registry.npmjs.org` 只有百来 KB/s。

```bash
with-proxy bun install
```

## 构建

```bash
bun run build     # 产出到 .output
bun run start     # 运行生产构建
```

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

通知的管理端（给指定用户发通知）没做界面：接口要 `user_id`，而用户列表页现在还是示例数据，
没有能拿到真实 id 的接口。等用户端接上真实数据再补。

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

- **筛选**：线上的模型 / User Agent 是可搜索下拉，本机用搜索框加状态分段（没有 Select 组件）。
- **分页**：线上手机端是「卡片流 + 加载更多」，本机桌面手机共用一套分页条。
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
