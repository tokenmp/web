import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { Show } from "solid-js";

import { Button } from "~/components/ui/button";
import { Select } from "~/components/ui/select";
import { cn, formatNumber } from "~/lib/utils";

const DEFAULT_SIZES = [10, 20, 50, 100];

/**
 * 分页条。桌面与手机同一份 —— 线上手机端是「卡片流 + 加载更多」，
 * 本机先用一套分页，少一份要维护的交互。
 *
 * 横向内边距收在组件里（16px，跟工具条、表头同一条线），调用方不要再包一层
 * px-4 或 px-5 的外壳 —— 之前两种都写过，同一个分页条在不同页面的位置差 4px。
 *
 * 禁用的口径：第一页禁上一页；page * size 已经覆盖总数就禁下一页。
 */
export function Pager(props: {
  page: number;
  size: number;
  total: number;
  onPageChange: (page: number) => void;
  /** 传了才显示「每页条数」。改完记得把页码归 1（调用方在 onSizeChange 里做） */
  onSizeChange?: (size: number) => void;
  sizeOptions?: number[];
  /** 已经待在一个自带横向内边距的底栏里时，传 `px-0` 去掉组件自带的内边距 */
  class?: string;
}) {
  const totalPages = () => Math.max(1, Math.ceil(props.total / props.size));
  const sizes = () => props.sizeOptions ?? DEFAULT_SIZES;

  return (
    <div class={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3", props.class)}>
      <div class="flex items-center gap-3">
        <span class="text-sm text-muted-foreground">共 {formatNumber(props.total)} 条</span>
        <Show when={props.onSizeChange}>
          <Select
            label="每页"
            labelPlacement="inline"
            class="w-[5.5rem]"
            options={sizes().map(size => ({ value: String(size), label: `${size} 条` }))}
            value={String(props.size)}
            onChange={value => props.onSizeChange?.(Number(value))}
          />
        </Show>
      </div>

      <div class="flex items-center gap-2">
        <span class="text-sm text-muted-foreground">
          第 {props.page}/{totalPages()} 页
        </span>
        <div class="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            class="size-8"
            onClick={() => props.onPageChange(props.page - 1)}
            disabled={props.page <= 1}
            aria-label="上一页"
          >
            <ChevronLeft class="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            class="size-8"
            onClick={() => props.onPageChange(props.page + 1)}
            disabled={props.page * props.size >= props.total}
            aria-label="下一页"
          >
            <ChevronRight class="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * 只在一页里放得下时才显示分页：数据少的时候多一条分页条只是噪声。
 *
 * 判据取「最小档的每页条数」而不是当前档 —— 否则用户刚把每页切到 50，
 * 分页条自己就消失了，切回去的入口也没了。
 */
export function PagerIfNeeded(props: {
  page: number;
  size: number;
  total: number;
  onPageChange: (page: number) => void;
  onSizeChange?: (size: number) => void;
  sizeOptions?: number[];
  class?: string;
}) {
  const threshold = () =>
    props.onSizeChange ? Math.min(...(props.sizeOptions ?? DEFAULT_SIZES)) : props.size;

  return (
    <Show when={props.total > threshold()}>
      <Pager {...props} />
    </Show>
  );
}
