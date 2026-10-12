import { Dialog as KDialog } from "@kobalte/core/dialog";
import { type VariantProps } from "class-variance-authority";
import X from "lucide-solid/icons/x";
import { Show, type JSX } from "solid-js";

import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export type SheetSide = "right" | "bottom";

/** 放在底部操作区里的关闭按钮，能拿到 Sheet 的上下文 */
export function SheetClose(props: {
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

export type SheetProps = {
  /** 触发器。受控用法（传了 open）可以不传 */
  trigger?: JSX.Element;
  /** right 用于桌面端的详情与筛选，bottom 用于移动端的操作选择 */
  side?: SheetSide;
  title: JSX.Element;
  description?: JSX.Element;
  children?: JSX.Element;
  footer?: JSX.Element;
  /** 宽度等外覆样式。要更宽或更窄时传进来，不必在页面里复制整套外壳 */
  class?: string;
  /** 覆盖触发器的按钮样式。整合行当触发器时要撑满整行、去掉描边与圆角 */
  triggerClass?: string;
  /** 传了就是受控：自己管开关。不传就跟触发器一起用，点触发器自己开 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * 两种抽屉的尺寸。
 *
 * 右侧抽屉原来固定 320px，放详情太挤：指标格得挤成两列，渠道明细那种四列表格
 * 直接横滚。改成跟着断点长：手机上占大半屏（留一点底页看得出可以点外面关掉），
 * 平板 26rem，桌面 32rem —— 跟线上面板详情弹窗的 max-w-lg 一个量级。
 */
const panelBySide: Record<SheetSide, string> = {
  right:
    "inset-y-0 right-0 h-full w-[92vw] border-l animate-panel-slide-left-in sm:w-[26rem] lg:w-[32rem]",
  bottom:
    "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t animate-panel-slide-up-in pb-safe",
};

/**
 * 侧边抽屉。side="right" 从右边滑入，用来放详情和筛选；side="bottom" 从底部升起，
 * 适合移动端。两者共用 Kobalte 的 Dialog 原语，所以焦点陷阱与关闭行为跟 Dialog 一致。
 *
 * 两种用法：
 *   1. 给一个 trigger，点它打开。
 *   2. 传 open 与 onOpenChange，自己控制开关，不要 trigger —— 一页里只有一个抽屉
 *      但要被多行触发时用这种（比如手机端的行列表，每行点开同一个操作面板），
 *      比每行各建一个 Dialog 轻。
 */
export function Sheet(props: SheetProps) {
  const side = () => props.side ?? "right";

  return (
    <KDialog open={props.open} onOpenChange={props.onOpenChange}>
      <Show when={props.trigger}>
        <KDialog.Trigger class={cn(buttonVariants({ variant: "outline" }), props.triggerClass)}>
          {props.trigger}
        </KDialog.Trigger>
      </Show>

      <KDialog.Portal>
        <KDialog.Overlay class="animate-overlay-in fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <KDialog.Content
          class={cn(
            "fixed z-50 flex flex-col bg-card shadow-lg focus:outline-none",
            panelBySide[side()],
            props.class,
          )}
        >
          <div class="flex items-start justify-between gap-4 border-b p-5">
            <div>
              <KDialog.Title class="font-semibold leading-none tracking-tight">
                {props.title}
              </KDialog.Title>
              <Show when={props.description}>
                <KDialog.Description class="mt-1.5 text-sm text-muted-foreground">
                  {props.description}
                </KDialog.Description>
              </Show>
            </div>
            <KDialog.CloseButton
              aria-label="关闭面板"
              class="hit-target -mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X class="size-4" />
            </KDialog.CloseButton>
          </div>

          <div class="flex-1 overflow-y-auto p-5 text-sm">{props.children}</div>

          <Show when={props.footer}>
            <div class="sticky-bottom-bar flex justify-end gap-2 border-t p-4">
              {props.footer}
            </div>
          </Show>
        </KDialog.Content>
      </KDialog.Portal>
    </KDialog>
  );
}
