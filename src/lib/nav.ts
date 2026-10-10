import ClipboardCheck from "lucide-solid/icons/clipboard-check";
import KeyRound from "lucide-solid/icons/key-round";
import LayoutDashboard from "lucide-solid/icons/layout-dashboard";
import Layers from "lucide-solid/icons/layers";
import Package from "lucide-solid/icons/package";
import ReceiptText from "lucide-solid/icons/receipt-text";
import Route from "lucide-solid/icons/route";
import Users from "lucide-solid/icons/users";
import Wallet from "lucide-solid/icons/wallet";

import type { NavItem } from "~/components/layout/app-shell";

/**
 * 管理端导航，控制台布局和 404 页共用同一份。
 *
 * 标了 primary 的会出现在移动端底部导航里 —— 底栏最多放五个位置，
 * 除了这四项还要留一个给「更多」，所以只挑最常点的：进来看总览、
 * 管用户、看钱（余额与计费）。剩下的收进「更多」抽屉。
 */
export const dashboardNav: NavItem[] = [
  {
    href: "/dashboard",
    label: "概览",
    primary: true,
    icon: () => <LayoutDashboard class="size-4" />,
  },
  { href: "/dashboard/users", label: "用户", primary: true, icon: () => <Users class="size-4" /> },
  {
    href: "/dashboard/balances",
    label: "余额",
    primary: true,
    icon: () => <Wallet class="size-4" />,
  },
  { href: "/dashboard/api-keys", label: "API 密钥", icon: () => <KeyRound class="size-4" /> },
  { href: "/dashboard/plans", label: "套餐", icon: () => <Package class="size-4" /> },
  {
    href: "/dashboard/billing",
    label: "计费",
    primary: true,
    icon: () => <ReceiptText class="size-4" />,
  },
  { href: "/dashboard/channels", label: "渠道", icon: () => <Route class="size-4" /> },
  {
    href: "/dashboard/channel-groups",
    label: "渠道分组",
    icon: () => <Layers class="size-4" />,
  },
  {
    href: "/dashboard/channel-applications",
    label: "渠道申请",
    icon: () => <ClipboardCheck class="size-4" />,
  },
];
