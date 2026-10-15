# 设计清单与组件清单

本地这套界面参照线上 tokenmp.top 销售控制台复刻。设计令牌取自线上站点的样式表，布局与页面结构参照它的路由划分。底色分层与投影两处有意偏离线上，理由写在下面对应的小节里。

## 设计清单

### 设计令牌

颜色写在 [src/app.css](src/app.css)，分浅色和深色两套。色值以 HSL 存在 CSS 变量里，再用 Tailwind v4 的 `@theme inline` 暴露成 `bg-background` 这类工具类。

| 令牌 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--background` | `210 40% 98%` | `222.2 84% 3.4%` | 页面底色，比卡片低一档 |
| `--foreground` | `222.2 84% 4.9%` | `210 40% 98%` | 正文 |
| `--card` | `0 0% 100%` | `222.2 84% 5.9%` | 卡片、侧边栏、弹层 |
| `--primary` | `222.2 47.4% 11.2%` | `210 40% 98%` | 主按钮、进度条、趋势线 |
| `--secondary`、`--muted`、`--accent` | `210 40% 96.1%` | `217.2 32.6% 17.5%` | 次级底、悬停底、弱化区块 |
| `--muted-foreground` | `215.4 16.3% 42%` | `215 20.2% 65.1%` | 说明文字、表头 |
| `--border` | `214.3 31.8% 92.5%` | `217.2 32.6% 15.5%` | 分隔线与卡片描边 |
| `--input` | `214.3 31.8% 88%` | `217.2 32.6% 20%` | 输入框与下拉触发器描边，比 `--border` 深一档 |
| `--success-text`、`--warning-text`、`--destructive-text` | 深绿、深琥珀、深红 | 同色相提亮 | 状态徽标的文字 |

`--success`、`--warning` 和三个 `-text` 令牌是线上样式表里没有的，本仓库补上。徽标用“15% 同色底加同色文字”，文字色要跟实心底色分开定义：线上那套 `--destructive` 在深色下是给实心按钮当底色的暗红，直接拿来写文字只有 2.09:1。分开之后浅色压深、深色提亮，最低 4.67:1，两套都过 AA。

| 项 | 值 |
| --- | --- |
| 圆角 | `--radius: 0.5rem`，`rounded-md`、`rounded-lg`、`rounded-xl` 由它派生 |
| 字体 | 系统栈：`-apple-system`、`PingFang SC`、`Microsoft YaHei` 等 |
| 数字 | 金额和用量加 `.tabular-nums`，位数对齐 |
| 控件高度 | 同一行里的控件只有两种高度：手机 40px、桌面 36px。输入框、下拉触发器、默认按钮、分段控件共用 `h-10 sm:h-9` 这一个写法 |
| 卡片内边距 | 横向一律 16px。工具条、表头、单元格、分页条从同一条线开始，不要写 `px-5` |
| 动效 | 默认 150ms，`prefers-reduced-motion` 下全局降到 0.01ms |
| 移动适配 | 输入框移动端 16px（避免 iOS 聚焦缩放），安全区用 `.pt-safe`、`.pb-safe` |

### 底色分层

页面底色比卡片低一档：浅色下是 98% 对 100%，深色下是 3.4% 对 5.9%。
线上两处同色，卡片全靠 1 像素描边分层；本地卡片里还有次级分块，同色叠下来分不出第三层，
描边叠描边就成了「框里套框」。

分层靠底色，不靠描边。卡片、弹窗、抽屉内部要分块时用 `Inset`（`bg-muted/60`），
不要再画一圈 `rounded border`。

### 层次与阴影

投影表示元素离页面多远，不当装饰用。

| z 轴 | 用在哪 | 类 |
| --- | --- | --- |
| 平面 | 卡片、卡片内分块、列表块 | 无投影 |
| 内凹 | 输入框、文本域、下拉触发器 | `inset-shadow-2xs` |
| 浮层 | 下拉面板、气泡、图表提示 | `shadow-md` |
| 模态 | 弹窗、抽屉、通知面板 | `shadow-lg` |

输入框是凹下去的，光从上方来，所以用内阴影表示上沿挡光，不挂外投影。
卡片不带投影，页面底色已经把它和背景分开了。

### 布局

| 区域 | 桌面（≥1024px） | 移动（<1024px） |
| --- | --- | --- |
| 导航 | 左侧固定侧边栏，宽 240px，右侧 1px 边框 | 底部导航，高 64px，四个常用项加一个「更多」 |
| 顶栏 | 高 56px，粘顶，半透明加毛玻璃，显示当前页名 | 同左 |
| 内容区 | 左边距 240px，内边距 24px | 内边距 16px 到 20px |
| 主题切换 | 侧边栏底部与顶栏账户菜单各一处 | 账户菜单里 |

控制台与用户面板共用这一套外壳。两边的 `nav` 数组不一样，布局只有一份。

### 页面

| 路由 | 页面 | 状态 |
| --- | --- | --- |
| `/` | 登录，登录与注册分段切换，密码可见性开关 | 已实现，接了认证接口 |
| `/dashboard` | 概览，指标卡与按天用量趋势 | 已实现，接了接口 |
| `/dashboard/users` | 用户列表、建号、改号、禁用启用、预算、客户端密钥 | 已实现，接了接口 |
| `/dashboard/balances` | 余额、调账、代充、批量充值、调账记录 | 已实现，接了接口 |
| `/dashboard/api-keys` | API 密钥，签发、停用启用、改属性、吊销 | 已实现，接了接口 |
| `/dashboard/plans` | 套餐、模型价、订阅概览与激活列表 | 已实现，接了接口 |
| `/dashboard/billing` | 计费流水 | 已实现，接了接口 |
| `/dashboard/request-records` | 调用记录，可按用户、模型、状态、时间范围筛选，带详情抽屉 | 已实现，等转发侧回写数据 |
| `/dashboard/recharge` | 充值单，可筛出未到账与失败的 | 已实现，接了接口 |
| `/dashboard/notifications` | 通知投递与发送 | 已实现，接了接口 |
| `/dashboard/channels` | 渠道 | 空页，接口是 remote，等转发侧 |
| `/dashboard/channel-groups` | 渠道分组 | 空页，接口是 remote，等转发侧 |
| `/dashboard/channel-applications` | 渠道申请 | 空页，接口是 remote，等转发侧 |
| `/dashboard/announcements` | 公告管理，草稿到发布的流程 | 已实现，接了接口 |
| `/panel` | 用户面板概览，五格指标、近 7 日用量图、当前套餐、最近流水 | 已实现，接了接口 |
| `/panel/keys` | 我的密钥，新建后明文只弹一次 | 已实现，接了接口 |
| `/panel/models` | 模型目录 | 空页，接口是 remote，等转发侧 |
| `/panel/request-records` | 请求日志，带详情抽屉 | 已实现，等转发侧回写数据 |
| `/panel/billing` | 账单流水 | 已实现，等转发侧回写数据 |
| `/panel/credits` | 余额明细 | 已实现，接了接口 |
| `/panel/plans` | 套餐与订阅、取消订阅 | 已实现，接了接口 |
| `/panel/accounts` | 分享的渠道账号 | 空页，接口是 remote，等转发侧 |
| `/panel/channels` | 我的渠道与申请 | 空页，接口是 remote，等转发侧 |
| `/panel/me` | 个人中心，余额与授信、预算、改密码 | 已实现，接了接口 |

还差最后一层的是「等转发侧回写数据」那几页：表、摄入接口、查询与页面都已就绪，
但 `/api/internal/records` 没有数据源，网关接上之前列表是空的。

上面标「空页」的六页原来渲染的是写死的样例（控制台三个渠道页各自内联，用户面板三页引自
`panel-data.ts`），现在只留页面标题，等接口实现再接 —— 假数据比空页更容易让人误判。

## 组件清单

### 基础组件

放在 `src/components/ui/`，写法沿用 shadcn/ui：`class-variance-authority` 管变体，`tailwind-merge` 合并外部传入的 `class`。遮罩层的焦点陷阱、Esc 关闭、点遮罩关闭、背景滚动锁定交给 `@kobalte/core` 的 Dialog 原语，这里只套样式。原语给的是前两条，右上角的 X 是本仓库自己渲染的，所以 `Dialog` 的 `dismissible={false}` 要单独把它一起判掉 —— 只在原语上拦，X 照样关得掉。

| 组件 | 文件 | 变体 |
| --- | --- | --- |
| Button | [button.tsx](src/components/ui/button.tsx) | default、destructive、outline、secondary、ghost、link；尺寸 sm、default、lg、icon |
| Card | [card.tsx](src/components/ui/card.tsx) | Card 及 Header、Title、Description、Content、Footer |
| Inset | [inset.tsx](src/components/ui/inset.tsx) | 卡片、弹窗、抽屉内部的次级区块，用 `bg-muted/60` 分层，不描边也不投影 |
| Input | [input.tsx](src/components/ui/input.tsx) | 单一形态，移动端 16px 高 40px，桌面 14px 高 36px |
| Label | [label.tsx](src/components/ui/label.tsx) | 单一形态 |
| Badge | [badge.tsx](src/components/ui/badge.tsx) | default、secondary、outline、success、warning、destructive |
| Segmented | [segmented.tsx](src/components/ui/segmented.tsx) | 分段切换，选中项用主色实心底；选项可传字符串数组或 {value, label}。高度跟输入框走同一条线（手机 40px、桌面 36px），选项带 `shrink-0` 与 `whitespace-nowrap`，窄屏下不会被压得把文字折成两行 |
| Table | [table.tsx](src/components/ui/table.tsx) | Table、TableHeader、TableBody、TableRow、TableHead、TableCell，窄屏横向滚动 |
| Textarea | [textarea.tsx](src/components/ui/textarea.tsx) | 单一形态，样式跟 Input 一致，用于公告正文 |
| Select | [select.tsx](src/components/ui/select.tsx) | 下拉选择，Kobalte 原语。对外只暴露「选项值字符串」（`string \| null`），Kobalte 认的选项对象换算收在组件里。放在 Dialog 里要传 `portal={false}`，标签交给它的 `label` 属性渲染（Kobalte 只认自己注册的标签 id） |
| Switch | [switch.tsx](src/components/ui/switch.tsx) | 开关，Kobalte 原语，真实 checkbox 藏在圆点下面（键盘与读屏都能用） |
| EmptyState | [empty-state.tsx](src/components/ui/empty-state.tsx) | 空态：标题、说明与可选操作。与失败态分开：「没有数据」是等，失败态是重试 |
| ErrorState | [error-state.tsx](src/components/ui/error-state.tsx) | 失败态：说明失败原因，`onRetry` 给一个就地重试的入口。`variant="inline"` 用于卡片内、表格行里这类窄场景；不传 `onRetry` 就只说明不画按钮（表单错误这类重试没用的场合） |
| DecimalSplit | [decimal-split.tsx](src/components/ui/decimal-split.tsx) | 大数拆分：整数部分常规、小数部分更小更淡 |
| Pager | [pager.tsx](src/components/ui/pager.tsx) | 分页条，带每页条数下拉；`PagerIfNeeded` 只在一页放不下时才出现。横向内边距收在组件里（16px），调用方不再包一层 `px-4` / `px-5` 的外壳；已经在带内边距的底栏里时传 `class="px-0"` |
| Toolbar | [toolbar.tsx](src/components/ui/toolbar.tsx) | 卡片顶部那一条筛选与操作行，配套 `ToolbarSearch`、`ToolbarSpacer`、`ToolbarDivider`。行内控件的标签一律画在控件左边（Select 传 `labelPlacement="inline"`），分段控件不给可见标签，两个分段之间插分隔线。末尾的控件用 `ToolbarSpacer` 顶到最右，它在手机上也要渲染；末尾控件会单独落到下一行时用 `ml-auto` |
| Dialog | [dialog.tsx](src/components/ui/dialog.tsx) | 居中模态，底部操作区可自定义，配套 `DialogClose`。`dismissible={false}` 给「关了就拿不回来」的弹窗（明文密钥只展示一次）用：点遮罩、按 Esc、点右上角的 X 三条路一起堵上，只能靠 `footer` 里的按钮关 |
| Sheet | [sheet.tsx](src/components/ui/sheet.tsx) | `side="right"` 右侧抽屉（手机 92vw、平板 26rem、桌面 32rem），`side="bottom"` 底部抽屉（手机端放操作选择），配套 `SheetClose`；宽度可用 `class` 覆盖。两种用法：给一个 `trigger` 点开，或传 `open` 与 `onOpenChange` 自己控制、不要触发器 —— 一个抽屉要被多行触发时用后者，比每行各建一个 Dialog 轻。`triggerClass` 可以覆盖触发器的按钮样式（整行当触发器时要撑满、去掉描边） |

### 布局组件

| 组件 | 文件 | 说明 |
| --- | --- | --- |
| AppShell | [app-shell.tsx](src/components/layout/app-shell.tsx) | 控制台与用户面板共用的外壳：侧边栏（宽 240px，断点 `lg`）、顶栏、手机底部导航与「更多」抽屉。接收 `nav` 数组，按路径最长匹配点亮导航项，标了 `primary` 的项进底栏 |
| VersionLabel | 同上 | 页脚的系统版本号，桌面端在侧边栏底部，移动端在「更多」抽屉末尾 |
| AnnouncementBanner | [announcement-banner.tsx](src/components/layout/announcement-banner.tsx) | 全站公告条，按级别着色（提示 / 注意 / 重要），可关闭的带关闭按钮 |
| NotificationBell | [notification-bell.tsx](src/components/layout/notification-bell.tsx) | 顶栏通知铃铛，Kobalte Popover 装的列表，带未读徽标 |
| PageHeader | [page-header.tsx](src/components/layout/page-header.tsx) | 页面头部：一句说明加右侧操作区。页面名由顶栏显示，这里不再重复放标题。说明占满剩下的宽度，所以只有按钮的页面按钮也停在右边。按钮管的就是下面那张卡片时，放进卡片的工具条（`ToolbarSpacer` 顶到最右），页头只留给管整页的操作 |
| StatRow | 同上 | 一排指标卡，页面概览用。有补充说明的卡片用 `mt-auto` 把说明压到底部，一排卡片的高度对齐 |

### 面板组件

放在 [src/components/panel](src/components/panel)，只给用户面板用。

| 组件 | 文件 | 说明 |
| --- | --- | --- |
| ResponsiveTable | [responsive-table.tsx](src/components/panel/responsive-table.tsx) | 同一份数据桌面渲染表格、手机渲染一份行列表（`divide-y` 连成一张列表，每行不画描边也不加底色），用 `md:` 切换，不靠 JS 判断断点。传了 `actions` 时手机端整行可点，点开底部操作面板把操作竖向列出；桌面端照旧在「操作」列直接摆按钮 |
| UsageChart | [usage-chart.tsx](src/components/panel/usage-chart.tsx) | 近 7 日按模型堆叠的柱状图，手写 SVG，悬浮出当天明细 |
| Delta | [delta.tsx](src/components/panel/delta.tsx) | 流水变动，入账成功色、扣款危险色，带符号 |
| DetailRow / MetricGrid | [detail-row.tsx](src/components/panel/detail-row.tsx) | 详情抽屉里的「标签 - 值」行与指标格 |
| CopyableId | [copyable-id.tsx](src/components/panel/copyable-id.tsx) | 请求 ID 这类标识，等宽加复制按钮 |
| Section | [section.tsx](src/components/panel/section.tsx) | 分节标题加说明 |

### 页面内组件

概览页的几个组件都在 [dashboard/index.tsx](src/routes/dashboard/index.tsx) 里，还没抽成独立文件。
公告管理页的表单弹窗（新建与编辑共用一个）同理，在 [dashboard/announcements.tsx](src/routes/dashboard/announcements.tsx) 里。

| 组件 | 说明 |
| --- | --- |
| StatCard | 指标卡：标题、数值、环比涨跌 |
| TrendChart | 14 天趋势面积图，手写 SVG，没有引图表库 |
| Th、Td | 表格单元格，负责内边距和文字对齐 |

### 状态与工具

| 文件 | 说明 |
| --- | --- |
| [src/store/theme.ts](src/store/theme.ts) | 外观偏好，值为 `light`、`dark`、`system`，存 `localStorage` 的 `tokenmp.theme`，落到 `<html class="dark">` |
| [src/lib/utils.ts](src/lib/utils.ts) | `cn()` 合并类名，`formatNumber()`、`formatCurrency()` 与几个时间格式化 |
| [src/lib/system.ts](src/lib/system.ts) | 版本、公告、通知的客户端数据层，走 `/api` 下的接口 |
| [src/lib/panel-labels.ts](src/lib/panel-labels.ts) | 面板里各种状态值到徽标的映射 |
| [src/lib/panel-nav.tsx](src/lib/panel-nav.tsx) | 面板导航，跟控制台的 [nav.tsx](src/lib/nav.tsx) 同一种写法：一列平铺，标了 `primary` 的进手机底栏 |
| [src/lib/resource.ts](src/lib/resource.ts) | `createClientResource()`：只在客户端取数，避开 SSR 下的相对路径 `fetch` |
| [src/entry-server.tsx](src/entry-server.tsx) | 首屏内联脚本，在 bundle 之前读偏好加 `.dark`，避免闪白 |
