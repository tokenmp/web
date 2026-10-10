import { A, useLocation } from "@solidjs/router";
import { Menu, Moon, Sun, X } from "lucide-solid";
import { createSignal, For, Show, type JSX } from "solid-js";

import { cn } from "~/lib/utils";
import { resolvedTheme, toggleTheme } from "~/store/theme";

export type NavItem = {
  href: string;
  label: string;
  icon: () => JSX.Element;
};

/**
 * 控制台外壳：桌面端固定侧边栏，移动端改为抽屉 + 顶栏。
 * 页面标题从当前命中的导航项取，没有命中的就退回 fallbackTitle。
 */
export function AppShell(props: {
  nav: NavItem[];
  fallbackTitle: string;
  children: JSX.Element;
}) {
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const location = useLocation();

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

  const navList = (onNavigate?: () => void) => (
    <nav class="flex flex-col gap-1 px-3">
      <For each={props.nav}>
        {item => (
          <A
            href={item.href}
            onClick={onNavigate}
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
  );

  // 写成函数而不是常量：同一个 JSX 元素实例只能在 DOM 里出现一次，
  // 常量被两处引用时，第二次插入会把节点从第一处移走，侧边栏的 logo 就空了
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
        <div class="flex-1 overflow-y-auto py-2">{navList()}</div>
        <div class="border-t p-3">
          <ThemeToggle />
        </div>
      </aside>

      {/* 移动端抽屉 */}
      <Show when={drawerOpen()}>
        <div
          class="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      </Show>
      <aside
        class={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card transition-transform duration-200 lg:hidden",
          drawerOpen() ? "translate-x-0" : "-translate-x-full",
        )}
        aria-hidden={!drawerOpen()}
        inert={drawerOpen() ? undefined : true}
      >
        <div class="flex items-center justify-between">
          {brand()}
          <button
            type="button"
            aria-label="关闭菜单"
            onClick={() => setDrawerOpen(false)}
            class="hit-target mr-3 grid size-8 place-items-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <X class="size-4" />
          </button>
        </div>
        <div class="flex-1 overflow-y-auto py-2">{navList(() => setDrawerOpen(false))}</div>
        <div class="border-t p-3">
          <ThemeToggle />
        </div>
      </aside>

      {/* 主区 */}
      <div class="lg:pl-60">
        <header class="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur lg:px-6">
          <button
            type="button"
            aria-label="打开菜单"
            onClick={() => setDrawerOpen(true)}
            class="hit-target grid size-8 place-items-center rounded-md text-muted-foreground hover:text-foreground lg:hidden"
          >
            <Menu class="size-5" />
          </button>
          <h1 class="text-base font-semibold tracking-tight">{currentTitle()}</h1>
          <div class="ml-auto lg:hidden">
            <ThemeToggle compact />
          </div>
        </header>

        <main class="px-4 py-5 lg:px-6 lg:py-6">{props.children}</main>
      </div>
    </div>
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
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        props.compact && "px-2 py-0",
      )}
    >
      {isDark() ? <Sun class="size-4" /> : <Moon class="size-4" />}
      <span class={cn(props.compact && "hidden")}>{isDark() ? "浅色模式" : "深色模式"}</span>
    </button>
  );
}
