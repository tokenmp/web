import { splitProps, type ComponentProps } from "solid-js";

import { cn } from "~/lib/utils";

export function Input(props: ComponentProps<"input"> & { class?: string }) {
  const [local, others] = splitProps(props, ["class", "type"]);
  return (
    <input
      type={local.type ?? "text"}
      class={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-1 text-base shadow-sm transition-colors",
        "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:text-sm",
        local.class,
      )}
      {...others}
    />
  );
}
