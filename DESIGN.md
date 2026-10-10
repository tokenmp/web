# 设计清单与组件清单

本地这套界面参照线上 tokenmp.top 销售控制台复刻。设计令牌直接取自线上站点的样式表，布局与页面结构参照它的路由划分。

## 设计清单

### 设计令牌

颜色写在 [src/app.css](src/app.css)，分浅色和深色两套。色值以 HSL 存在 CSS 变量里，再用 Tailwind v4 的 `@theme inline` 暴露成 `bg-background` 这类工具类。

| 令牌 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--background` | `0 0% 100%` | `222.2 84% 4.9%` | 页面底色 |
| `--foreground` | `222.2 84% 4.9%` | `210 40% 98%` | 正文 |
| `--card` | `0 0% 100%` | `222.2 84% 4.9%` | 卡片、侧边栏、弹层 |
| `--primary` | `222.2 47.4% 11.2%` | `210 40% 98%` | 主按钮、进度条、趋势线 |
| `--secondary`、`--muted`、`--accent` | `210 40% 96.1%` | `217.2 32.6% 17.5%` | 次级底、悬停底、弱化区块 |
| `--muted-foreground` | `215.4 16.3% 42%` | `215 20.2% 65.1%` | 说明文字、表头 |
| `--border`、`--input` | `214.3 31.8% 91.4%` | `217.2 32.6% 17.5%` | 边框与输入框描边 |
| `--success-text`、`--warning-text`、`--destructive-text` | 深绿、深琥珀、深红 | 同色相提亮 | 状态徽标的文字 |

`--success`、`--warning` 和三个 `-text` 令牌是线上样式表里没有的，本地补上。徽标用“15% 同色底加同色文字”，文字色要跟实心底色分开定义：线上那套 `--destructive` 在深色下是给实心按钮当底色的暗红，直接拿来写文字只有 2.09:1。分开之后浅色压深、深色提亮，最低 4.67:1，两套都过 AA。

| 项 | 值 |
| --- | --- |
| 圆角 | `--radius: 0.5rem`，`rounded-md`、`rounded-lg`、`rounded-xl` 由它派生 |
| 字体 | 系统栈：`-apple-system`、`PingFang SC`、`Microsoft YaHei` 等 |
| 数字 | 金额和用量加 `.tabular-nums`，位数对齐 |
| 动效 | 默认 150ms，`prefers-reduced-motion` 下全局降到 0.01ms |
| 移动适配 | 输入框移动端 16px（避免 iOS 聚焦缩放），安全区用 `.pt-safe`、`.pb-safe` |

### 布局

| 区域 | 桌面（≥1024px） | 移动（<1024px） |
| --- | --- | --- |
| 导航 | 左侧固定侧边栏，宽 240px，右侧 1px 边框 | 抽屉，宽 256px，遮罩点击关闭 |
| 顶栏 | 高 56px，粘顶，半透明加毛玻璃，显示当前页名 | 同左，左侧多一个汉堡按钮 |
| 内容区 | 左边距 240px，内边距 24px | 内边距 16px 到 20px |
| 主题切换 | 侧边栏底部，带文字 | 顶栏右侧，只有图标 |

用户面板（`/panel`）是另一套外壳：侧栏按 模型与密钥 / 数据 / 财务 / 账户 分四组，断点用 `md`（768px），
手机底栏五项铺满，登出与换主题收进「个人中心」页。版面与线上一致，取舍写在 [README](README.md) 的「用户面板」一节。

### 页面

| 路由 | 页面 | 状态 |
| --- | --- | --- |
| `/` | 登录，登录与注册分段切换，密码可见性开关 | 已实现，未接接口 |
| `/dashboard` | 概览，4 张指标卡、14 天消耗趋势、渠道占比、最近订单 | 已实现，示例数据 |
| `/dashboard/users` | 用户列表 | 已实现，示例数据 |
| `/dashboard/balances` | 余额 | 已实现，示例数据 |
| `/dashboard/api-keys` | API 密钥 | 已实现，示例数据 |
| `/dashboard/plans` | 套餐 | 已实现，示例数据 |
| `/dashboard/billing` | 计费 | 已实现，示例数据 |
| `/dashboard/channels` | 渠道 | 已实现，示例数据 |
| `/dashboard/channel-groups` | 渠道分组 | 已实现，示例数据 |
| `/dashboard/channel-applications` | 渠道申请 | 已实现，示例数据 |
| `/dashboard/announcements` | 公告管理，草稿到发布的流程 | 已实现，接了后端接口 |
| `/panel` | 用户面板概览，五格指标、近 7 日用量图、当前套餐、最近流水 | 已实现，示例数据 |
| `/panel/keys` | 我的密钥，新建后明文只弹一次 | 已实现，示例数据 |
| `/panel/models` | 模型目录与降级链 | 已实现，示例数据 |
| `/panel/request-records` | 请求日志，带详情抽屉 | 已实现，示例数据 |
| `/panel/billing` | 账单流水 | 已实现，示例数据 |
| `/panel/credits` | 余额明细 | 已实现，示例数据 |
| `/panel/plans` | 套餐与订阅 | 已实现，示例数据 |
| `/panel/accounts` | 分享的渠道账号 | 已实现，示例数据 |
| `/panel/channels` | 我的渠道与申请 | 已实现，示例数据 |
| `/panel/me` | 个人中心，额度、预算与偏好 | 已实现，示例数据 |

## 组件清单

### 基础组件

放在 `src/components/ui/`，写法沿用 shadcn/ui：`class-variance-authority` 管变体，`tailwind-merge` 合并外部传入的 `class`。遮罩层的焦点陷阱、Esc 关闭、点遮罩关闭、背景滚动锁定交给 `@kobalte/core` 的 Dialog 原语，这里只套样式。

| 组件 | 文件 | 变体 |
| --- | --- | --- |
| Button | [button.tsx](src/components/ui/button.tsx) | default、destructive、outline、secondary、ghost、link；尺寸 sm、default、lg、icon |
| Card | [card.tsx](src/components/ui/card.tsx) | Card 及 Header、Title、Description、Content、Footer |
| Input | [input.tsx](src/components/ui/input.tsx) | 单一形态，移动端 16px 高 40px，桌面 14px 高 36px |
| Label | [label.tsx](src/components/ui/label.tsx) | 单一形态 |
| Badge | [badge.tsx](src/components/ui/badge.tsx) | default、secondary、outline、success、warning、destructive |
| Segmented | [segmented.tsx](src/components/ui/segmented.tsx) | 分段切换，选中项用主色实心底；选项可传字符串数组或 {value, label} |
| Table | [table.tsx](src/components/ui/table.tsx) | Table、TableHeader、TableBody、TableRow、TableHead、TableCell，窄屏横向滚动 |
| Textarea | [textarea.tsx](src/components/ui/textarea.tsx) | 单一形态，样式跟 Input 一致，用于公告正文 |
| Switch | [switch.tsx](src/components/ui/switch.tsx) | 开关，Kobalte 原语，真实 checkbox 藏在圆点下面（键盘与读屏都能用） |
| EmptyState | [empty-state.tsx](src/components/ui/empty-state.tsx) | 空态：标题、说明与可选操作，失败态另写 |
| DecimalSplit | [decimal-split.tsx](src/components/ui/decimal-split.tsx) | 大数拆分：整数部分常规、小数部分更小更淡 |
| Pager | [pager.tsx](src/components/ui/pager.tsx) | 分页条，`PagerIfNeeded` 只在一页放不下时才出现 |
| Dialog | [dialog.tsx](src/components/ui/dialog.tsx) | 居中模态，底部操作区可自定义，配套 `DialogClose` |
| Sheet | [sheet.tsx](src/components/ui/sheet.tsx) | `side="right"` 桌面右侧抽屉，`side="bottom"` 移动端底部抽屉，配套 `SheetClose` |

### 布局组件

| 组件 | 文件 | 说明 |
| --- | --- | --- |
| AppShell | [app-shell.tsx](src/components/layout/app-shell.tsx) | 侧边栏、顶栏、移动抽屉。接收 `nav` 数组，按路径最长匹配点亮导航项，抽屉关闭时带 `inert` |
| VersionLabel | 同上 | 页脚的系统版本号，桌面端在侧边栏底部，移动端在「更多」抽屉末尾 |
| AnnouncementBanner | [announcement-banner.tsx](src/components/layout/announcement-banner.tsx) | 全站公告条，按级别着色（提示 / 注意 / 重要），可关闭的带关闭按钮 |
| NotificationBell | [notification-bell.tsx](src/components/layout/notification-bell.tsx) | 顶栏通知铃铛，Kobalte Popover 装的列表，带未读徽标 |
| PageHeader | [page-header.tsx](src/components/layout/page-header.tsx) | 页面头部：一句说明加右侧操作区。页面名由顶栏显示，这里不再重复放标题 |
| StatRow | 同上 | 一排指标卡，页面概览用 |

### 面板组件

放在 [src/components/panel](src/components/panel)，只给用户面板用。

| 组件 | 文件 | 说明 |
| --- | --- | --- |
| ResponsiveTable | [responsive-table.tsx](src/components/panel/responsive-table.tsx) | 同一份数据桌面渲染表格、手机渲染卡片流，用 `md:` 切换，不靠 JS 判断断点 |
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
| [src/lib/panel-data.ts](src/lib/panel-data.ts) | 用户面板的示例数据与类型，字段名照 openapi.yaml 的 UserPanel 一组 |
| [src/lib/panel-labels.ts](src/lib/panel-labels.ts) | 面板里各种状态值到徽标的映射 |
| [src/lib/panel-nav.tsx](src/lib/panel-nav.tsx) | 面板的分组导航与手机底栏 |
| [src/lib/resource.ts](src/lib/resource.ts) | `createClientResource()`：只在客户端取数，避开 SSR 下的相对路径 `fetch` |
| [src/entry-server.tsx](src/entry-server.tsx) | 首屏内联脚本，在 bundle 之前读偏好加 `.dark`，避免闪白 |
