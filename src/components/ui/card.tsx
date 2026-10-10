import { splitProps, type ComponentProps } from "solid-js";

import { cn } from "~/lib/utils";

export function Card(props: ComponentProps<"div"> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);
  // 不带投影：卡片靠比页面底色亮一档分开层次，投影留给真正浮起来的弹层
  return (
    <div
      class={cn("rounded-xl border bg-card text-card-foreground", local.class)}
      {...others}
    />
  );
}

export function CardHeader(props: ComponentProps<"div"> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("flex flex-col space-y-1.5 p-6", local.class)} {...others} />;
}

export function CardTitle(props: ComponentProps<"div"> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("font-semibold leading-none tracking-tight", local.class)} {...others} />;
}

export function CardDescription(props: ComponentProps<"div"> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("text-sm text-muted-foreground", local.class)} {...others} />;
}

export function CardContent(props: ComponentProps<"div"> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("p-6 pt-0", local.class)} {...others} />;
}

export function CardFooter(props: ComponentProps<"div"> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("flex items-center p-6 pt-0", local.class)} {...others} />;
}
