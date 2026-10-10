import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { Show } from "solid-js";

import { Button } from "~/components/ui/button";
import { Select } from "~/components/ui/select";
import { formatNumber } from "~/lib/utils";

const DEFAULT_SIZES = [10, 20, 50, 100];

/**
 * 分页条。桌面与手机同一份 —— 线上手机端是「卡片流 + 加载更多」，
 * 本机先用一套分页，少一份要维护的交互。
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
}) {
  const totalPages = () => Math.max(1, Math.ceil(props.total / props.size));
  const sizes = () => props.sizeOptions ?? DEFAULT_SIZES;

  return (
    <div class="flex flex-wrap items-center justify-between gap-3 py-3">
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
}) {
  const threshold = () =>
    props.onSizeChange ? Math.min(...(props.sizeOptions ?? DEFAULT_SIZES)) : props.size;

  return (
    <Show when={props.total > threshold()}>
      <Pager {...props} />
    </Show>
  );
}
