import { For, type JSX } from "solid-js";

/** 详情里的「标签 - 值」一行。值常是 JSX（复制按钮、徽标），所以按元素收 */
export function DetailRow(props: { label: string; value: JSX.Element }) {
  return (
    <div class="flex items-start justify-between gap-4">
      <dt class="shrink-0 text-muted-foreground">{props.label}</dt>
      <dd class="min-w-0 text-right font-medium">{props.value}</dd>
    </div>
  );
}

/** 详情里的一组指标格：两列平铺，用 1px 间隙画出分隔线 */
export function MetricGrid(props: { items: { label: string; value: string }[] }) {
  return (
    <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
      <For each={props.items}>
        {item => (
          <div class="bg-card px-3 py-2.5">
            <dt class="text-xs text-muted-foreground">{item.label}</dt>
            <dd class="mt-0.5 text-sm font-medium tabular-nums">{item.value}</dd>
          </div>
        )}
      </For>
    </dl>
  );
}
