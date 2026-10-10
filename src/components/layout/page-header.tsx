import { Show, type JSX } from "solid-js";

/** 页面头部：标题、一句说明、右侧操作区 */
export function PageHeader(props: {
  title: string;
  description?: string;
  children?: JSX.Element;
}) {
  return (
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">{props.title}</h1>
        <Show when={props.description}>
          <p class="mt-1 text-sm text-muted-foreground">{props.description}</p>
        </Show>
      </div>
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
