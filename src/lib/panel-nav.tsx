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

import type { NavItem } from "~/components/layout/app-shell";

/**
 * 用户面板导航。
 *
 * 跟控制台的 nav.tsx 是同一份写法：一列平铺，标了 primary 的进手机底栏。
 * 面板原来按 模型与密钥 / 数据 / 财务 / 账户 分四组，配一套单独的侧栏外壳；
 * 现在两套界面共用 app-shell，外壳不给分组留位置，这里就展平成一列，
 * 顺序跟分组时保持一致。
 *
 * 手机底栏放四个最常点的：概览、我的密钥、请求日志、个人中心。
 * 剩下的模型目录、套餐、账单流水、余额明细、我的账号、我的渠道收在「更多」抽屉里。
 */
export const panelNav: NavItem[] = [
  { href: "/panel", label: "概览", primary: true, icon: () => <LayoutDashboard class="size-4" /> },
  { href: "/panel/models", label: "模型目录", icon: () => <Library class="size-4" /> },
  { href: "/panel/keys", label: "我的密钥", primary: true, icon: () => <KeyRound class="size-4" /> },
  {
    href: "/panel/request-records",
    label: "请求日志",
    primary: true,
    icon: () => <ScrollText class="size-4" />,
  },
  { href: "/panel/plans", label: "套餐", icon: () => <Package class="size-4" /> },
  { href: "/panel/billing", label: "账单流水", icon: () => <Receipt class="size-4" /> },
  { href: "/panel/credits", label: "余额明细", icon: () => <Wallet class="size-4" /> },
  { href: "/panel/accounts", label: "我的账号", icon: () => <Server class="size-4" /> },
  { href: "/panel/channels", label: "我的渠道", icon: () => <Share2 class="size-4" /> },
  {
    href: "/panel/me",
    label: "个人中心",
    primary: true,
    icon: () => <UserRound class="size-4" />,
  },
];
