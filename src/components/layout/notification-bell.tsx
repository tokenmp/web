import { Popover as KPopover } from "@kobalte/core/popover";
import { useNavigate } from "@solidjs/router";
import Bell from "lucide-solid/icons/bell";
import CheckCheck from "lucide-solid/icons/check-check";
import { createSignal, For, Show } from "solid-js";

import { ErrorState } from "~/components/ui/error-state";
import { createClientResource } from "~/lib/resource";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationFeed,
  type NotificationItem,
} from "~/lib/system";
import { cn, formatRelativeTime } from "~/lib/utils";

const EMPTY: NotificationFeed = { items: [], total: 0, unread: 0 };
const PAGE_SIZE = 20;

/**
 * 顶栏的通知铃铛。
 *
 * 面板里只放最近 20 条：通知打开就是要看最新的几条，超过的用 total 提示一句，
 * 不做翻页 —— 真要看历史的话，这个面板也不是合适的容器。
 *
 * 标已读用乐观更新：先改本地状态再发请求，失败就整份重新拉一次，
 * 免得未读数和实际对不上（接口本身是幂等的，重试不会出错）。
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = createSignal(false);
  const { data, setData, loading, error, reload } = createClientResource(
    () => fetchNotifications({ size: PAGE_SIZE }),
    EMPTY,
  );

  const unread = () => data().unread;
  const hasMore = () => data().total > data().items.length;

  const markRead = async (id: number) => {
    const item = data().items.find(row => row.id === id);
    if (!item || item.read_at) return;

    const stamp = new Date().toISOString();
    setData(prev => ({
      ...prev,
      items: prev.items.map(row => (row.id === id ? { ...row, read_at: stamp } : row)),
      unread: Math.max(0, prev.unread - 1),
    }));

    try {
      await markNotificationRead(id);
    } catch {
      void reload();
    }
  };

  const readAll = async () => {
    const stamp = new Date().toISOString();
    setData(prev => ({
      ...prev,
      items: prev.items.map(row => (row.read_at ? row : { ...row, read_at: stamp })),
      unread: 0,
    }));

    try {
      await markAllNotificationsRead();
    } catch {
      void reload();
    }
  };

  // 点了通知：先标已读，有动作地址就跳过去。站内路径交给路由，外部地址整页跳
  const visit = (item: NotificationItem) => {
    void markRead(item.id);
    setOpen(false);

    const url = item.action_url;
    if (!url) return;
    if (url.startsWith("/")) navigate(url);
    else window.location.assign(url);
  };

  return (
    <KPopover open={open()} onOpenChange={setOpen} gutter={8} placement="bottom-end">
      <KPopover.Trigger
        aria-label={unread() > 0 ? `通知，${unread()} 条未读` : "通知"}
        class="hit-target relative grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[expanded]:bg-accent data-[expanded]:text-foreground"
      >
        <Bell class="size-[18px]" aria-hidden="true" />
        <Show when={unread() > 0}>
          <span class="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
            {unread() > 99 ? "99+" : unread()}
          </span>
        </Show>
      </KPopover.Trigger>

      <KPopover.Portal>
        <KPopover.Content class="animate-panel-fade-in z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-card shadow-lg focus:outline-none">
          <div class="flex items-center justify-between gap-3 border-b px-4 py-3">
            <KPopover.Title class="text-sm font-semibold tracking-tight">通知</KPopover.Title>
            <Show when={unread() > 0}>
              <button
                type="button"
                onClick={readAll}
                class="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <CheckCheck class="size-3.5" aria-hidden="true" />
                全部已读
              </button>
            </Show>
          </div>

          <div class="max-h-[min(60dvh,26rem)] overflow-y-auto">
            <Show when={error()}>
              <ErrorState
                variant="inline"
                class="px-4"
                message={error()!}
                onRetry={() => void reload()}
              />
            </Show>

            <Show when={!error() && data().items.length === 0}>
              <p class="px-4 py-8 text-center text-sm text-muted-foreground">
                {loading() ? "正在加载…" : "暂时没有通知"}
              </p>
            </Show>

            <For each={data().items}>{item => <NotificationRow item={item} onOpen={visit} />}</For>
          </div>

          <Show when={hasMore()}>
            <p class="border-t px-4 py-2.5 text-xs text-muted-foreground">
              共 {data().total} 条，这里只显示最近 {data().items.length} 条
            </p>
          </Show>
        </KPopover.Content>
      </KPopover.Portal>
    </KPopover>
  );
}

/** 一行通知。整行可点，所以内部元素统一用 span：button 里不能放 div、p */
function NotificationRow(props: { item: NotificationItem; onOpen: (item: NotificationItem) => void }) {
  const read = () => Boolean(props.item.read_at);

  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.item)}
      class="flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {/* 未读用一个点标记，读过的留同宽的透明占位，两行文字才对得齐 */}
      <span
        aria-hidden="true"
        class={cn("mt-1.5 size-2 shrink-0 rounded-full", read() ? "bg-transparent" : "bg-destructive")}
      />

      <span class="min-w-0 flex-1">
        <span class="flex items-baseline justify-between gap-2">
          <span class={cn("truncate text-sm", read() ? "text-muted-foreground" : "font-medium")}>
            {props.item.title}
          </span>
          <span class="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatRelativeTime(props.item.created_at)}
          </span>
        </span>

        <Show when={props.item.body}>
          <span class="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
            {props.item.body}
          </span>
        </Show>

        <Show when={props.item.action_label}>
          <span class="mt-1.5 inline-block text-xs font-medium underline underline-offset-2">
            {props.item.action_label}
          </span>
        </Show>
      </span>
    </button>
  );
}
