import { A, useLocation } from "@solidjs/router";
import LogOut from "lucide-solid/icons/log-out";
import { For, Show, type JSX } from "solid-js";

import { AnnouncementBanner } from "~/components/layout/announcement-banner";
import { NotificationBell } from "~/components/layout/notification-bell";
import { ThemeToggle } from "~/components/layout/app-shell";
import { cn } from "~/lib/utils";

export type PanelNavItem = {
  href: string;
  label: string;
  icon: () => JSX.Element;
  /** 只在路径完全相等时算激活。`/panel` 是 `/panel/*` 的前缀，不加这个会一直亮着 */
  end?: boolean;
};

export type PanelNavGroup = {
  label?: string;
  items: PanelNavItem[];
};

export type PanelTabItem = Omit<PanelNavItem, "icon"> & { icon: () => JSX.Element };

export type PanelUser = {
  name: string;
  email?: string | null;
};

/**
 * 用户面板外壳。
 *
 * 跟控制台（app-shell）的结构一样，但有两处不同：
 *   1. 侧栏按 模型与密钥 / 数据 / 财务 / 账户 分组 —— 面板有十项，平铺看不出主次
 *   2. 断点用 md（768px）而不是 lg：面板在平板上也该用侧栏，用户多半是边看边操作
 *
 * 手机端底栏放五个常用项，登出与换主题收进「个人中心」页 ——
 * 面板的顶栏比控制台窄，再塞账户菜单会挤掉页面标题。
 */
export function PanelShell(props: {
  nav: PanelNavGroup[];
  tabs: PanelTabItem[];
  fallbackTitle: string;
  user?: PanelUser | null;
  children: JSX.Element;
}) {
  const location = useLocation();

  const items = () => props.nav.flatMap(group => group.items);

  const isActive = (item: PanelNavItem) =>
    item.end
      ? location.pathname === item.href
      : location.pathname === item.href || location.pathname.startsWith(`${item.href}/`);

  // 命中路径最长的那个才算当前页，否则 /panel 会把所有子页点亮
  const currentTitle = () => {
    const hit = items()
      .filter(isActive)
      .sort((a, b) => b.href.length - a.href.length)[0];
    return hit?.label ?? props.fallbackTitle;
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    // 整页跳转而不是 navigate：顺手把内存里的用户状态也清干净
    window.location.assign("/");
  };

  return (
    <div class="min-h-dvh bg-background">
      {/* 桌面端侧栏 */}
      <aside class="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r bg-card md:flex">
        <div class="flex h-14 items-center gap-2.5 border-b px-4">
          <div class="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            T
          </div>
          <span class="text-base font-semibold tracking-tight">TokenMP</span>
          <span class="ml-auto rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            用户
          </span>
        </div>

        <nav class="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          <For each={props.nav}>
            {group => (
              <div>
                <Show when={group.label}>
                  <p class="px-3 pb-1 pt-3 text-[11px] font-medium text-muted-foreground/80">
                    {group.label}
                  </p>
                </Show>
                <div class="space-y-0.5">
                  <For each={group.items}>
                    {item => (
                      <A
                        href={item.href}
                        aria-current={isActive(item) ? "page" : undefined}
                        class={cn(
                          "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                          isActive(item)
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
                        )}
                      >
                        {/* 选中项左缘加一道指示条：分组之后的浅底不够显眼 */}
                        <Show when={isActive(item)}>
                          <span
                            class="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-full bg-foreground"
                            aria-hidden="true"
                          />
                        </Show>
                        {item.icon()}
                        <span>{item.label}</span>
                      </A>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </nav>

        <div class="space-y-1 border-t p-2">
          <div class="flex items-center gap-2.5 px-2 py-1.5">
            <span class="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {(props.user?.name ?? "U").slice(0, 1).toUpperCase()}
            </span>
            <span class="min-w-0 flex-1 leading-tight">
              <span class="block truncate text-sm font-medium">{props.user?.name ?? "未登录"}</span>
              <span class="block truncate text-[11px] text-muted-foreground">
                {props.user?.email ?? ""}
              </span>
            </span>
          </div>

          <ThemeToggle />

          <button
            type="button"
            onClick={logout}
            class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <LogOut class="size-4" aria-hidden="true" />
            退出登录
          </button>
        </div>
      </aside>

      <div class="md:pl-56">
        {/* 桌面端页头：与内容同宽居中，粘顶 */}
        <header class="sticky top-0 z-20 hidden border-b bg-background/80 backdrop-blur md:block">
          <div class="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 px-6">
            <h1 class="truncate text-base font-semibold tracking-tight">{currentTitle()}</h1>
            <div class="ml-auto flex shrink-0 items-center gap-1">
              <NotificationBell />
            </div>
          </div>
        </header>

        {/* 手机端单层页头。换主题与登出在「个人中心」页，这里只留通知 */}
        <header class="pt-safe sticky top-0 z-30 flex h-12 items-center gap-1 border-b bg-background/95 px-4 backdrop-blur md:hidden">
          <h1 class="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
            {currentTitle()}
          </h1>
          <NotificationBell />
        </header>

        {/* 底栏固定占 48px 起，正文留出 pb-24，否则最后一行会被压住 */}
        <main class="mx-auto w-full max-w-[1400px] p-4 pb-24 md:px-6 md:py-6 md:pb-6">
          <AnnouncementBanner class="mb-4" />
          {props.children}
        </main>
      </div>

      <PanelTabBar items={props.tabs} />
    </div>
  );
}

/** 手机端底部导航：五项均分，激活态用主色加顶部指示条，点按区不低于 48px */
function PanelTabBar(props: { items: PanelTabItem[] }) {
  const location = useLocation();

  const isActive = (item: PanelTabItem) =>
    item.end
      ? location.pathname === item.href
      : location.pathname === item.href || location.pathname.startsWith(`${item.href}/`);

  return (
    <nav
      aria-label="主导航"
      class="pb-safe fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur md:hidden"
    >
      <div class="flex items-stretch">
        <For each={props.items}>
          {item => (
            <A
              href={item.href}
              aria-current={isActive(item) ? "page" : undefined}
              class={cn(
                "relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
                isActive(item) ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Show when={isActive(item)}>
                <span class="absolute inset-x-6 top-0 h-0.5 rounded-b-full bg-primary" aria-hidden="true" />
              </Show>
              {item.icon()}
              <span>{item.label}</span>
            </A>
          )}
        </For>
      </div>
    </nav>
  );
}
