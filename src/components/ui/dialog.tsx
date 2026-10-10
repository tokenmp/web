import { Dialog as KDialog } from "@kobalte/core/dialog";
import { type VariantProps } from "class-variance-authority";
import X from "lucide-solid/icons/x";
import { Show, type JSX } from "solid-js";

import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export type DialogProps = {
  /** 触发按钮的内容，样式沿用默认按钮 */
  trigger: JSX.Element;
  /** 触发按钮的无障碍名。列表里有多行同名按钮（例如每行的「通过」）时必填，否则读屏只念出「通过」 */
  triggerLabel?: string;
  title: string;
  description?: string;
  children?: JSX.Element;
  /** 底部操作区，不传就给一个「关闭」 */
  footer?: JSX.Element;
  class?: string;
};

/** 放在底部操作区里的关闭按钮，能拿到 Dialog 的上下文 */
export function DialogClose(props: {
  children: JSX.Element;
  variant?: VariantProps<typeof buttonVariants>["variant"];
  class?: string;
}) {
  return (
    <KDialog.CloseButton
      class={cn(buttonVariants({ variant: props.variant ?? "outline" }), props.class)}
    >
      {props.children}
    </KDialog.CloseButton>
  );
}

/**
 * 居中模态弹窗。焦点陷阱、Esc 关闭、遮罩点击关闭、背景滚动锁定都由 Kobalte 的
 * Dialog 原语负责，这里只套设计系统的样式。
 */
export function Dialog(props: DialogProps) {
  return (
    <KDialog>
      <KDialog.Trigger
        aria-label={props.triggerLabel}
        class={cn(buttonVariants({ variant: "outline" }))}
      >
        {props.trigger}
      </KDialog.Trigger>

      <KDialog.Portal>
        <KDialog.Overlay class="animate-overlay-in fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <KDialog.Content
          class={cn(
            "animate-panel-fade-in fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md",
            "-translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg",
            "focus:outline-none",
            props.class,
          )}
        >
          <KDialog.Title class="pr-8 text-lg font-semibold leading-none tracking-tight">
            {props.title}
          </KDialog.Title>
          <Show when={props.description}>
            <KDialog.Description class="mt-2 text-sm text-muted-foreground">
              {props.description}
            </KDialog.Description>
          </Show>

          <Show when={props.children}>
            <div class="mt-4 text-sm">{props.children}</div>
          </Show>

          <div class="mt-6 flex justify-end gap-2">
            {props.footer ?? (
              <KDialog.CloseButton class={cn(buttonVariants({ variant: "outline" }))}>
                关闭
              </KDialog.CloseButton>
            )}
          </div>

          <KDialog.CloseButton
            aria-label="关闭弹窗"
            class="hit-target absolute right-4 top-4 grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <X class="size-4" />
          </KDialog.CloseButton>
        </KDialog.Content>
      </KDialog.Portal>
    </KDialog>
  );
}
