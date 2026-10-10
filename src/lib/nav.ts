import {
  ClipboardCheck,
  KeyRound,
  LayoutDashboard,
  Layers,
  Package,
  ReceiptText,
  Route,
  Users,
  Wallet,
} from "lucide-solid";

import type { NavItem } from "~/components/layout/app-shell";

/** 管理端导航，控制台布局和 404 页共用同一份 */
export const dashboardNav: NavItem[] = [
  { href: "/dashboard", label: "概览", icon: () => <LayoutDashboard class="size-4" /> },
  { href: "/dashboard/users", label: "用户", icon: () => <Users class="size-4" /> },
  { href: "/dashboard/balances", label: "余额", icon: () => <Wallet class="size-4" /> },
  { href: "/dashboard/api-keys", label: "API 密钥", icon: () => <KeyRound class="size-4" /> },
  { href: "/dashboard/plans", label: "套餐", icon: () => <Package class="size-4" /> },
  { href: "/dashboard/billing", label: "计费", icon: () => <ReceiptText class="size-4" /> },
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
