import { splitProps, type ComponentProps } from "solid-js";

import { cn } from "~/lib/utils";

/**
 * 卡片内部的次级区块。
 *
 * 卡片、弹窗、抽屉本身已经带边框，里面再画一圈边框就成了「框里套框」。
 * 这里只靠底色分层：浅色显得近、深色显得远，不描边也不投影。
 * 尺寸交给调用方，默认给一段内边距。
 */
export function Inset(props: ComponentProps<"div"> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("rounded-lg bg-muted/60 p-4", local.class)} {...others} />;
}
