import { For } from "solid-js";

import { cn } from "~/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: string };

/**
 * 分段控件。选中项用主色实心底加反白文字，跟容器的浅灰底拉开距离 ——
 * 原来用 secondary 加阴影的写法在浅色下几乎看不出选中。
 *
 * 传入字符串数组时选项的文字就是它本身，需要显示文案与取值不同时再传 {value, label}。
 */
export function Segmented<T extends string>(props: {
  options: readonly (T | SegmentedOption<T>)[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  class?: string;
}) {
  const normalize = (option: T | SegmentedOption<T>): SegmentedOption<T> =>
    typeof option === "string" ? { value: option, label: option } : option;

  return (
    <div
      role="group"
      aria-label={props.ariaLabel}
      class={cn("inline-flex items-center gap-1 rounded-lg bg-muted p-1", props.class)}
    >
      <For each={props.options.map(normalize)}>
        {option => (
          <button
            type="button"
            onClick={() => props.onChange(option.value)}
            aria-pressed={props.value === option.value}
            class={cn(
              "inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              props.value === option.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}
