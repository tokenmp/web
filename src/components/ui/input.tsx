import { splitProps, type ComponentProps } from "solid-js";

import { cn } from "~/lib/utils";

export function Input(props: ComponentProps<"input"> & { class?: string }) {
  const [local, others] = splitProps(props, ["class", "type"]);
  return (
    <input
      type={local.type ?? "text"}
      class={cn(
        // 输入框是凹下去的：用内阴影模拟上沿挡光，不挂外投影
        "flex h-10 w-full rounded-md border border-input bg-card px-3 text-base inset-shadow-2xs transition-colors",
        "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:text-sm",
        local.class,
      )}
      {...others}
    />
  );
}
