import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { Show, type JSX } from "solid-js";

import { cn } from "~/lib/utils";

/**
 * 失败态：说明失败了，并给一个就地重试的入口。
 *
 * 与 EmptyState 分开：「没有数据」和「取数失败」要长得不一样，也要能做不一样的事 ——
 * 空态是等，失败态是重试。之前每页各写一句 `<p role="alert">`，失败之后只能刷整页，
 * 而 reload 本来就在手上。
 *
 * 失败用 --destructive 一系：浅色下是深红字加淡红底，深色下同色相提亮，
 * 和 Badge 的 destructive 一个口径。
 */
export function ErrorState(props: {
  /** 失败说明。不传就给一句通用的 */
  message?: string;
  /** 重试回调。不传则不画按钮（比如不可重试的表单错误） */
  onRetry?: () => void;
  /** 重试按钮文案 */
  retryLabel?: string;
  /** 卡片内、表格行里这类窄场景传 inline：换成一行横排，不占一整块 */
  variant?: "block" | "inline";
  class?: string;
  children?: JSX.Element;
}) {
  const message = () => props.message ?? "加载失败";

  return (
    <div
      class={cn(
        "flex flex-col items-center justify-center gap-2 px-4 py-8 text-center",
        props.variant === "inline" &&
          "flex-row items-center justify-center gap-3 py-2.5 text-left",
        "bg-destructive/10 text-sm text-destructive-text",
        props.class,
      )}
      role="alert"
    >
      <div
        class={cn(
          "flex flex-col items-center gap-1.5",
          props.variant === "inline" && "flex-row items-center gap-2",
        )}
      >
        <TriangleAlert class="size-4 shrink-0" aria-hidden="true" />
        <Show when={props.children} fallback={<p>{message()}</p>}>
          <div class="min-w-0">{props.children}</div>
        </Show>
      </div>
      <Show when={props.onRetry}>
        <button
          type="button"
          class={cn(
            "rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium",
            "transition-colors hover:bg-destructive/15",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
            props.variant === "inline" ? "shrink-0" : "mt-1",
          )}
          onClick={() => props.onRetry?.()}
        >
          {props.retryLabel ?? "重试"}
        </button>
      </Show>
    </div>
  );
}
