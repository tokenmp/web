import { For } from "solid-js";

import { cn } from "~/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: string };

/**
 * 分段控件。选中项用主色实心底加反白文字，跟容器的浅灰底拉开距离 ——
 * 原来用 secondary 加阴影的写法在浅色下几乎看不出选中。
 *
 * 传入字符串数组时选项的文字就是它本身，需要显示文案与取值不同时再传 {value, label}。
 *
 * 高度跟输入框、下拉触发器走同一条线（手机 40px、桌面 36px）：容器固定高，
 * 选项用 h-full 填满内层，不再靠 p-1 加 h-8 凑出来。选项带 shrink-0 与
 * whitespace-nowrap，窄屏下不会被压得比文字还窄、把两个字折成两行。
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
      class={cn(
        "inline-flex h-10 shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5 sm:h-9",
        props.class,
      )}
    >
      <For each={props.options.map(normalize)}>
        {option => (
          <button
            type="button"
            onClick={() => props.onChange(option.value)}
            aria-pressed={props.value === option.value}
            class={cn(
              "inline-flex h-full shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors",
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
