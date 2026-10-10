import { cn } from "~/lib/utils";

/**
 * 拆分小数显示：整数部分常规、小数部分更小更淡（632.5 → 632 加 .5）。
 *
 * 积分动辄六七位数，小数那截跟着一起放大就会抢走注意力。
 * 传进来的是已经格式化好的字符串（formatPoints 那种），没有小数就原样渲染。
 */
export function DecimalSplit(props: { text: string; class?: string }) {
  const dot = () => props.text.indexOf(".");

  return (
    <span class={cn("tabular-nums", props.class)}>
      {props.text.slice(0, dot() === -1 ? undefined : dot())}
      {dot() !== -1 && (
        <span class="text-[0.8em] font-normal text-muted-foreground/70">{props.text.slice(dot())}</span>
      )}
    </span>
  );
}
