import CircleAlert from "lucide-solid/icons/circle-alert";
import Info from "lucide-solid/icons/info";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import X from "lucide-solid/icons/x";
import { createSignal, For, Show } from "solid-js";

import { createClientResource } from "~/lib/resource";
import { dismissAnnouncement, fetchAnnouncements, type Announcement } from "~/lib/system";
import { cn } from "~/lib/utils";

/** 未登录时接口记不了关闭状态（dismiss 会返回 401），退回本地记录 */
const LOCAL_KEY = "tokenmp.dismissed_announcements";

function readLocalDismissed(): number[] {
  // 用 typeof window 判而不是 typeof localStorage：Node 里也有 localStorage
  // 这个全局（要 --localstorage-file 才真的能用），碰一下就会打一条 ExperimentalWarning
  if (typeof window === "undefined") return [];
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(LOCAL_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((id): id is number => typeof id === "number") : [];
  } catch {
    return [];
  }
}

function rememberLocalDismissed(id: number) {
  if (typeof window === "undefined") return;
  try {
    // 只留最近 100 条，公告会不断更替，本地这份记录不必无限长
    const next = [...new Set([...readLocalDismissed(), id])].slice(-100);
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
  } catch {
    // 无痕模式下写不进去。这次会话里已经收起来了，不值得再报一次错
  }
}

/** 级别只影响视觉：底色加同色文字，文字色用 -text 那套，两套外观都过 AA */
function severityClass(severity: string) {
  if (severity === "urgent") return "border-destructive/30 bg-destructive/15 text-destructive-text";
  if (severity === "warning") return "border-warning/30 bg-warning/15 text-warning-text";
  return "border-border bg-secondary/70 text-secondary-foreground";
}

function severityIcon(severity: string) {
  const cls = "mt-0.5 size-4 shrink-0";
  if (severity === "urgent") return <CircleAlert class={cls} aria-hidden="true" />;
  if (severity === "warning") return <TriangleAlert class={cls} aria-hidden="true" />;
  return <Info class={cls} aria-hidden="true" />;
}

/**
 * 全站公告条，放在控制台内容区顶部（登录页也用它）。
 *
 * 关掉是先收起来再发请求：网络不通或者接口失败时，用户点了「关闭」就该消失，
 * 不该弹回来。登录用户的关闭状态存在服务端，换台设备也不会重新弹。
 */
export function AnnouncementBanner(props: { class?: string }) {
  const { data } = createClientResource<Announcement[]>(fetchAnnouncements, []);
  const [hidden, setHidden] = createSignal<number[]>(readLocalDismissed());

  // 服务端记的（登录用户）与本地记的（未登录用户）都算关过
  const visible = () => data().filter(item => !item.dismissed && !hidden().includes(item.id));

  const close = (item: Announcement) => {
    setHidden(prev => [...prev, item.id]);
    rememberLocalDismissed(item.id);
    void dismissAnnouncement(item.id).catch(() => undefined);
  };

  return (
    <Show when={visible().length > 0}>
      <section aria-label="公告" class={cn("space-y-2", props.class)}>
        <For each={visible()}>
          {item => (
            <div
              class={cn(
                "flex items-start gap-3 rounded-lg border px-3.5 py-3",
                severityClass(item.severity),
              )}
            >
              {severityIcon(item.severity)}

              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium">{item.title}</p>
                <p class="mt-0.5 whitespace-pre-wrap break-words text-sm opacity-90">{item.body}</p>
              </div>

              <Show when={item.dismissible}>
                <button
                  type="button"
                  onClick={() => close(item)}
                  aria-label={`关闭公告：${item.title}`}
                  class="hit-target -mr-1 -mt-0.5 grid size-6 shrink-0 place-items-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <X class="size-3.5" aria-hidden="true" />
                </button>
              </Show>
            </div>
          )}
        </For>
      </section>
    </Show>
  );
}
