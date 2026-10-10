import Activity from "lucide-solid/icons/activity";
import KeyRound from "lucide-solid/icons/key-round";
import LayoutDashboard from "lucide-solid/icons/layout-dashboard";
import Library from "lucide-solid/icons/library";
import Package from "lucide-solid/icons/package";
import Receipt from "lucide-solid/icons/receipt";
import ScrollText from "lucide-solid/icons/scroll-text";
import Server from "lucide-solid/icons/server";
import Share2 from "lucide-solid/icons/share-2";
import UserRound from "lucide-solid/icons/user-round";
import Wallet from "lucide-solid/icons/wallet";

import type { PanelNavGroup, PanelTabItem } from "~/components/layout/panel-shell";

/**
 * 用户面板导航。
 *
 * 分成 模型与密钥 / 数据 / 财务 / 账户 四组 —— 用户面板比控制台多得多，
 * 十项平铺在侧边栏里会看不出主次。概览不归组，置顶。
 *
 * 手机底栏只放五个：概览、密钥、模型、请求、我的。渠道与账号这些
 * 一周看不了几次的，从概览的统计卡或「我的」页进。
 */
export const panelNav: PanelNavGroup[] = [
  {
    items: [{ href: "/panel", label: "概览", icon: () => <LayoutDashboard class="size-4" />, end: true }],
  },
  {
    label: "模型与密钥",
    items: [
      { href: "/panel/models", label: "模型目录", icon: () => <Library class="size-4" /> },
      { href: "/panel/keys", label: "我的密钥", icon: () => <KeyRound class="size-4" /> },
    ],
  },
  {
    label: "数据",
    items: [
      { href: "/panel/request-records", label: "请求日志", icon: () => <ScrollText class="size-4" /> },
    ],
  },
  {
    label: "财务",
    items: [
      { href: "/panel/plans", label: "套餐", icon: () => <Package class="size-4" /> },
      { href: "/panel/billing", label: "账单流水", icon: () => <Receipt class="size-4" /> },
      { href: "/panel/credits", label: "余额明细", icon: () => <Wallet class="size-4" /> },
    ],
  },
  {
    label: "账户",
    items: [
      { href: "/panel/accounts", label: "我的账号", icon: () => <Server class="size-4" /> },
      { href: "/panel/channels", label: "我的渠道", icon: () => <Share2 class="size-4" /> },
      { href: "/panel/me", label: "个人中心", icon: () => <UserRound class="size-4" /> },
    ],
  },
];

/** 手机底栏。五项刚好铺满，拇指够得到，也不用记自己在哪一层 */
export const panelTabs: PanelTabItem[] = [
  { href: "/panel", label: "概览", icon: () => <LayoutDashboard class="size-5" />, end: true },
  { href: "/panel/keys", label: "密钥", icon: () => <KeyRound class="size-5" /> },
  { href: "/panel/models", label: "模型", icon: () => <Library class="size-5" /> },
  { href: "/panel/request-records", label: "请求", icon: () => <Activity class="size-5" /> },
  { href: "/panel/me", label: "我的", icon: () => <UserRound class="size-5" /> },
];
