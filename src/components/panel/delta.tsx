import { cn } from "~/lib/utils";
import { DecimalSplit } from "~/components/ui/decimal-split";
import { formatPoints } from "~/lib/utils";

/**
 * 流水变动：入账用成功色、扣款用危险色，都带符号。
 *
 * 颜色取设计令牌里的 -text 那一套（浅色压深、深色提亮，两套都过 AA），
 * 不要拿实心按钮的底色当文字色。
 *
 * 绝对值交给 formatPoints：它算的是元，负数传进去会得到 "-0.42" 这样的字符串，
 * 符号与小数点的拆分会把负号并进整数部分，读起来容易看错，所以这里自己带符号。
 */
export function Delta(props: { value: number; class?: string }) {
  const positive = () => props.value >= 0;

  return (
    <span
      class={cn(
        "text-sm font-semibold tabular-nums",
        positive() ? "text-success-text" : "text-destructive-text",
        props.class,
      )}
    >
      {positive() ? "+" : "−"}
      <DecimalSplit text={formatPoints(Math.abs(props.value))} />
    </span>
  );
}
