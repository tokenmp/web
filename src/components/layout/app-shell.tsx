import { Dialog as KDialog } from "@kobalte/core/dialog";
import { DropdownMenu as KDropdownMenu } from "@kobalte/core/dropdown-menu";
import { A, useLocation } from "@solidjs/router";
import Ellipsis from "lucide-solid/icons/ellipsis";
import LogOut from "lucide-solid/icons/log-out";
import Moon from "lucide-solid/icons/moon";
import Sun from "lucide-solid/icons/sun";
import X from "lucide-solid/icons/x";
import { createSignal, For, Show, type JSX } from "solid-js";

import { AnnouncementBanner } from "~/components/layout/announcement-banner";
import { NotificationBell } from "~/components/layout/notification-bell";
import { createClientResource } from "~/lib/resource";
import { fetchSystemVersion, type SystemVersion } from "~/lib/system";
import { cn } from "~/lib/utils";
import { resolvedTheme, toggleTheme } from "~/store/theme";

export type NavItem = {
  href: string;
  label: string;
  icon: () => JSX.Element;
  /** 是否出现在移动端底部导航。底栏最多五个位置，只标最常用的几项 */
  primary?: boolean;
};

export type ShellUser = {
  name: string;
  email?: string | null;
  role?: string;
};

/**
 * 控制台外壳。
 *
 * 桌面端：左侧固定侧边栏装下全部导航，顶栏右上角是账户菜单。
 * 移动端：不用抽屉 —— 抽屉要先点开汉堡、再找目标、还得再关一次，
 * 常用页面要走三步。改成底部导航，四个常用项加一个「更多」，
 * 拇指够得到，也不用记自己在哪一层。账户菜单两端都在右上角。
 *
 * 页面标题从当前命中的导航项取，没有命中的就退回 fallbackTitle。
 */
export function AppShell(props: {
  nav: NavItem[];
  fallbackTitle: string;
  children: JSX.Element;
  user?: ShellUser | null;
}) {
  const location = useLocation();

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    // 用整页跳转而不是 navigate，顺手把内存里的用户状态也清干净
    window.location.assign("/");
  };

  // 命中路径最长的导航项才算激活，否则 /dashboard 会把所有子页都点亮
  const activeHref = () => {
    const pathname = location.pathname;
    return props.nav
      .map(item => item.href)
      .filter(href => pathname === href || pathname.startsWith(`${href}/`))
      .sort((a, b) => b.length - a.length)[0];
  };

  const currentTitle = () =>
    props.nav.find(item => item.href === activeHref())?.label ?? props.fallbackTitle;

  // 写成函数而不是常量：同一个 JSX 元素实例只能在 DOM 里出现一次，
  // 常量被两处引用时，第二次插入会把节点从第一处移走
  const brand = () => (
    <div class="flex items-center gap-2.5 px-5 py-4">
      <div class="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
        T
      </div>
      <span class="font-semibold tracking-tight">TokenMP</span>
    </div>
  );

  return (
    <div class="min-h-dvh bg-muted/30">
      {/* 桌面端侧边栏 */}
      <aside class="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-card lg:flex">
        {brand()}
        <nav class="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
          <For each={props.nav}>
            {item => (
              <A
                href={item.href}
                aria-current={activeHref() === item.href ? "page" : undefined}
                class={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  activeHref() === item.href
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {item.icon()}
                <span>{item.label}</span>
              </A>
            )}
          </For>
        </nav>
        <div class="border-t p-2">
          <ThemeToggle />
          <VersionLabel class="px-3 pb-0.5 pt-2" />
        </div>
      </aside>

      <div class="lg:pl-60">
        <header class="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur lg:px-6">
          <h1 class="truncate text-base font-semibold tracking-tight">{currentTitle()}</h1>
          <div class="ml-auto flex shrink-0 items-center gap-1">
            <NotificationBell />
            <UserMenu user={props.user} onLogout={logout} />
          </div>
        </header>

        {/* 底部导航固定占掉 64px，给内容留出等高的下边距，否则最后一行会被压住 */}
        <main class="px-4 py-5 pb-24 lg:px-6 lg:py-6 lg:pb-6">
          <AnnouncementBanner class="mb-4" />
          {props.children}
        </main>
      </div>

      <BottomNav nav={props.nav} activeHref={activeHref()} />
    </div>
  );
}

/** 顶栏右上角的账户菜单：看一眼自己是谁、切主题、退出 */
function UserMenu(props: { user?: ShellUser | null; onLogout: () => void }) {
  const isDark = () => resolvedTheme() === "dark";
  const initial = () => (props.user?.name ?? "?").slice(0, 1).toUpperCase();

  const itemClass =
    "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium outline-none transition-colors data-[highlighted]:bg-accent";

  return (
    <KDropdownMenu gutter={6} placement="bottom-end">
      <KDropdownMenu.Trigger
        aria-label="账户菜单"
        class="hit-target flex items-center gap-2 rounded-full p-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[expanded]:bg-accent lg:pr-2.5"
      >
        <span class="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
          {initial()}
        </span>
        <Show when={props.user}>
          <span class="hidden max-w-24 truncate text-sm font-medium lg:inline">
            {props.user!.name}
          </span>
        </Show>
      </KDropdownMenu.Trigger>

      <KDropdownMenu.Portal>
        <KDropdownMenu.Content class="animate-panel-fade-in z-50 min-w-56 rounded-xl border bg-card p-1.5 shadow-lg">
          <Show when={props.user}>
            <div class="px-2.5 py-2">
              <p class="truncate text-sm font-medium">{props.user!.name}</p>
              <p class="truncate text-xs text-muted-foreground">
                {props.user!.email ?? props.user!.role}
              </p>
            </div>
            <KDropdownMenu.Separator class="my-1 h-px bg-border" />
          </Show>

          <KDropdownMenu.Item onSelect={toggleTheme} class={itemClass}>
            {isDark() ? <Sun class="size-4" /> : <Moon class="size-4" />}
            <span>{isDark() ? "浅色模式" : "深色模式"}</span>
          </KDropdownMenu.Item>

          <Show when={props.user}>
            <KDropdownMenu.Separator class="my-1 h-px bg-border" />
            <KDropdownMenu.Item
              onSelect={props.onLogout}
              class={cn(itemClass, "text-destructive-text")}
            >
              <LogOut class="size-4" />
              <span>退出登录</span>
            </KDropdownMenu.Item>
          </Show>
        </KDropdownMenu.Content>
      </KDropdownMenu.Portal>
    </KDropdownMenu>
  );
}

/**
 * 移动端底部导航。十项塞不进底栏，所以只放四个最常点的，
 * 剩下的连同全部入口一起收在「更多」里。
 */
function BottomNav(props: { nav: NavItem[]; activeHref?: string }) {
  const [moreOpen, setMoreOpen] = createSignal(false);
  const primary = () => props.nav.filter(item => item.primary);
  const inMore = () => !primary().some(item => item.href === props.activeHref);

  const tabClass = (active: boolean) =>
    cn(
      "flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
      active ? "text-primary" : "text-muted-foreground",
    );

  return (
    <>
      <nav
        aria-label="主导航"
        class="pb-safe fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur lg:hidden"
      >
        <div class="flex h-16 items-stretch">
          <For each={primary()}>
            {item => (
              <A
                href={item.href}
                aria-current={props.activeHref === item.href ? "page" : undefined}
                class={tabClass(props.activeHref === item.href)}
              >
                {/* nav.ts 里的图标写死了 size-4，底栏需要更大一号，这里统一放大 */}
                <span class="[&_svg]:size-5">{item.icon()}</span>
                <span class="max-w-full truncate px-1">{item.label}</span>
              </A>
            )}
          </For>

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen()}
            class={tabClass(inMore())}
          >
            <Ellipsis class="size-5" />
            <span>更多</span>
          </button>
        </div>
      </nav>

      <KDialog open={moreOpen()} onOpenChange={setMoreOpen}>
        <KDialog.Portal>
          <KDialog.Overlay class="animate-overlay-in fixed inset-0 z-50 bg-black/50 lg:hidden" />
          <KDialog.Content class="animate-panel-slide-up-in pb-safe fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto rounded-t-xl border-t bg-card lg:hidden">
            <div class="flex items-center justify-between px-5 pt-4">
              <KDialog.Title class="text-base font-semibold tracking-tight">全部功能</KDialog.Title>
              <KDialog.CloseButton
                aria-label="关闭"
                class="hit-target -mr-1 grid size-8 place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <X class="size-4" />
              </KDialog.CloseButton>
            </div>

            <div class="grid gap-1 p-3">
              <For each={props.nav}>
                {item => (
                  <A
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={props.activeHref === item.href ? "page" : undefined}
                    class={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      props.activeHref === item.href
                        ? "bg-secondary text-secondary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <span class="[&_svg]:size-5">{item.icon()}</span>
                    <span>{item.label}</span>
                  </A>
                )}
              </For>
            </div>

            {/* 桌面端的版本号在侧边栏底部，手机上侧边栏不出现，这里补一个落脚点 */}
            <VersionLabel class="border-t px-5 py-3" />
          </KDialog.Content>
        </KDialog.Portal>
      </KDialog>
    </>
  );
}

/**
 * 页脚版本号。版本号对所有人生效，桌面端放侧边栏底部，
 * 手机上没有侧边栏，放在「更多」抽屉的末尾。取不到就什么都不显示。
 */
export function VersionLabel(props: { class?: string }) {
  const { data } = createClientResource<SystemVersion | null>(() => fetchSystemVersion(), null);
  const version = () => data()?.version;
  const channel = () => data()?.channel;

  return (
    <Show when={version()}>
      <p class={cn("text-xs text-muted-foreground", props.class)}>
        v{version()}
        <Show when={channel()}>
          <span> · {channel()}</span>
        </Show>
      </p>
    </Show>
  );
}

export function ThemeToggle(props: { compact?: boolean }) {
  const isDark = () => resolvedTheme() === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark() ? "切换到浅色" : "切换到深色"}
      class={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        props.compact && "px-2 py-0",
      )}
    >
      {isDark() ? <Sun class="size-4" /> : <Moon class="size-4" />}
      <span class={cn(props.compact && "hidden")}>{isDark() ? "浅色模式" : "深色模式"}</span>
    </button>
  );
}
