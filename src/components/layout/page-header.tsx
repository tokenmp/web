import { Show, type JSX } from "solid-js";

/** 页面头部：一句说明加右侧操作区。
 * 页面名已经在顶栏显示，这里不再重复放一遍大标题。 */
export function PageHeader(props: {
  description?: string;
  children?: JSX.Element;
}) {
  return (
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <Show when={props.description}>
        <p class="text-sm text-muted-foreground">{props.description}</p>
      </Show>
      <Show when={props.children}>
        <div class="flex flex-wrap items-center gap-2">{props.children}</div>
      </Show>
    </div>
  );
}

/** 顶部的一排指标，页面概览用 */
export function StatRow(props: { items: { label: string; value: string; hint?: string }[] }) {
  return (
    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {props.items.map(item => (
        <div class="rounded-xl border bg-card p-4 shadow-sm">
          <p class="text-sm text-muted-foreground">{item.label}</p>
          <p class="mt-1.5 text-xl font-semibold tabular-nums tracking-tight">{item.value}</p>
          {item.hint ? <p class="mt-1 text-xs text-muted-foreground">{item.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}
