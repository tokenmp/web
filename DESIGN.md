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

### 页面

| 路由 | 页面 | 状态 |
| --- | --- | --- |
| `/` | 登录，登录与注册分段切换，密码可见性开关 | 已实现，未接接口 |
| `/dashboard` | 概览，4 张指标卡、14 天消耗趋势、渠道占比、最近订单 | 已实现，示例数据 |
| `/dashboard/users` | 用户列表 | 未做 |
| `/dashboard/balances` | 余额 | 未做 |
| `/dashboard/api-keys` | API 密钥 | 未做 |
| `/dashboard/plans` | 套餐 | 未做 |
| `/dashboard/billing` | 计费 | 未做 |
| `/dashboard/channels` | 渠道 | 未做 |
| `/dashboard/channel-groups` | 渠道分组 | 未做 |
| `/dashboard/channel-applications` | 渠道申请 | 未做 |

线上另外还有一套用户侧页面（`/panel` 下的概览、密钥、账单、模型、渠道、我的），本地还没开始。

## 组件清单

### 基础组件

放在 `src/components/ui/`，写法沿用 shadcn/ui：`class-variance-authority` 管变体，`tailwind-merge` 合并外部传入的 `class`。

| 组件 | 文件 | 变体 |
| --- | --- | --- |
| Button | [button.tsx](src/components/ui/button.tsx) | default、destructive、outline、secondary、ghost、link；尺寸 sm、default、lg、icon |
| Card | [card.tsx](src/components/ui/card.tsx) | Card 及 Header、Title、Description、Content、Footer |
| Input | [input.tsx](src/components/ui/input.tsx) | 单一形态，移动端 16px 高 40px，桌面 14px 高 36px |
| Label | [label.tsx](src/components/ui/label.tsx) | 单一形态 |
| Badge | [badge.tsx](src/components/ui/badge.tsx) | default、secondary、outline、success、warning、destructive |

### 布局组件

| 组件 | 文件 | 说明 |
| --- | --- | --- |
| AppShell | [app-shell.tsx](src/components/layout/app-shell.tsx) | 侧边栏、顶栏、移动抽屉。接收 `nav` 数组，按路径最长匹配点亮导航项，抽屉关闭时带 `inert` |

### 页面内组件

都在 [dashboard/index.tsx](src/routes/dashboard/index.tsx) 里，还没抽成独立文件。

| 组件 | 说明 |
| --- | --- |
| StatCard | 指标卡：标题、数值、环比涨跌 |
| TrendChart | 14 天趋势面积图，手写 SVG，没有引图表库 |
| Th、Td | 表格单元格，负责内边距和文字对齐 |

### 状态与工具

| 文件 | 说明 |
| --- | --- |
| [src/store/theme.ts](src/store/theme.ts) | 外观偏好，值为 `light`、`dark`、`system`，存 `localStorage` 的 `tokenmp.theme`，落到 `<html class="dark">` |
| [src/lib/utils.ts](src/lib/utils.ts) | `cn()` 合并类名，`formatNumber()` 与 `formatCurrency()` 格式化数字 |
| [src/entry-server.tsx](src/entry-server.tsx) | 首屏内联脚本，在 bundle 之前读偏好加 `.dark`，避免闪白 |
