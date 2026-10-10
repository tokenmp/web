import { splitProps, type ComponentProps } from "solid-js";

import { cn } from "~/lib/utils";

/** 多行输入。样式跟 Input 一致，移动端同样保持 16px 以免 iOS 聚焦时放大 */
export function Textarea(props: ComponentProps<"textarea"> & { class?: string }) {
  const [local, others] = splitProps(props, ["class", "rows"]);
  return (
    <textarea
      rows={local.rows ?? 4}
      class={cn(
        "flex min-h-20 w-full rounded-md border border-input bg-card px-3 py-2 text-base inset-shadow-2xs transition-colors",
        "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
        local.class,
      )}
      {...others}
    />
  );
}
