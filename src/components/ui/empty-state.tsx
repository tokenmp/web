import Inbox from "lucide-solid/icons/inbox";
import { Show, type JSX } from "solid-js";

import { cn } from "~/lib/utils";

/**
 * 空态：说明这里本来该有什么，而不是只留一片白。
 *
 * 「没数据」和「加载失败」是两回事，失败态用 ErrorState 那种带重试入口的写法，
 * 别让人盯着一个空列表等。
 */
export function EmptyState(props: {
  title?: string;
  description?: string;
  action?: JSX.Element;
  class?: string;
}) {
  return (
    <div
      class={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-10 text-center",
        props.class,
      )}
    >
      <Inbox class="size-8 text-muted-foreground/50" aria-hidden="true" />
      <p class="text-sm font-medium">{props.title ?? "暂无数据"}</p>
      <Show when={props.description}>
        <p class="text-xs text-muted-foreground">{props.description}</p>
      </Show>
      <Show when={props.action}>
        <div class="mt-2">{props.action}</div>
      </Show>
    </div>
  );
}
