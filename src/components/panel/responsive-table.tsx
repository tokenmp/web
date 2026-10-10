import { For, Show, type JSX } from "solid-js";

import { EmptyState } from "~/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";

export type PanelColumn<T> = {
  header: string;
  cell: (item: T) => JSX.Element;
  /** 桌面端右对齐。手机上不生效：卡片按主次排，不按表格的列序 */
  align?: "right";
};

/**
 * 列表的两种呈现：桌面端表格，手机端卡片流。
 *
 * 手机上的横向滚动表格很难读，所以同一份数据渲染两遍，用 `md:` 切换。
 * 两边都由 CSS 控制，不靠 JS 判断断点 —— 服务端渲染出来的是同一份 DOM，
 * 不会先闪一下表格再跳成卡片。
 *
 * 行操作传一份 `actions`，桌面端自动多出一列，手机上落在卡片的分隔线下方。
 */
export function ResponsiveTable<T>(props: {
  items: T[];
  columns: PanelColumn<T>[];
  rowKey: (item: T) => string | number;
  /** 手机端卡片标题：挑最能认出这一行的那一列 */
  cardTitle: (item: T) => JSX.Element;
  /** 手机端卡片标题下面那行小字 */
  cardSubtitle?: (item: T) => JSX.Element;
  /** 手机端卡片右侧：金额、状态这类 */
  cardRight?: (item: T) => JSX.Element;
  /** 行操作。桌面端追加一列，手机上放卡片底部 */
  actions?: (item: T) => JSX.Element;
  onRowClick?: (item: T) => void;
  /** 表格最小宽度，列多的时候传，窄屏由容器横向滚动 */
  minWidth?: string;
  empty: string;
  emptyDescription?: string;
}) {
  const columns = () => props.columns;

  return (
    <>
      <div class="hidden md:block">
        <Table tableClass={props.minWidth}>
          <TableHeader>
            <TableRow>
              <For each={columns()}>{column => <TableHead class={column.align === "right" ? "text-right" : undefined}>{column.header}</TableHead>}</For>
              <Show when={props.actions}>
                <TableHead class="text-right">操作</TableHead>
              </Show>
            </TableRow>
          </TableHeader>

          <TableBody>
            <For each={props.items}>
              {item => (
                <TableRow
                  onClick={() => props.onRowClick?.(item)}
                  class={props.onRowClick ? "cursor-pointer" : undefined}
                >
                  <For each={columns()}>
                    {column => (
                      <TableCell class={column.align === "right" ? "text-right" : undefined}>
                        {column.cell(item)}
                      </TableCell>
                    )}
                  </For>
                  <Show when={props.actions}>
                    <TableCell class="text-right">{props.actions!(item)}</TableCell>
                  </Show>
                </TableRow>
              )}
            </For>

            <Show when={props.items.length === 0}>
              <TableRow>
                <TableCell
                  class="py-10 text-center text-muted-foreground"
                  colSpan={columns().length + (props.actions ? 1 : 0)}
                >
                  {props.empty}
                </TableCell>
              </TableRow>
            </Show>
          </TableBody>
        </Table>
      </div>

      <div class="space-y-3 md:hidden">
        <Show when={props.items.length === 0}>
          <EmptyState title={props.empty} description={props.emptyDescription} />
        </Show>

        <For each={props.items}>
          {item => (
            <div class="rounded-lg border bg-card shadow-sm">
              <div
                class="flex items-center gap-3 px-4 py-3"
                onClick={() => props.onRowClick?.(item)}
                role={props.onRowClick ? "button" : undefined}
              >
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium">{props.cardTitle(item)}</div>
                  <Show when={props.cardSubtitle}>
                    <div class="mt-0.5 truncate text-xs text-muted-foreground">
                      {props.cardSubtitle!(item)}
                    </div>
                  </Show>
                </div>
                <Show when={props.cardRight}>
                  <div class="shrink-0">{props.cardRight!(item)}</div>
                </Show>
              </div>

              <Show when={props.actions}>
                {/* 操作区挡住往上冒泡：点删除不该顺手打开详情 */}
                <div
                  class="flex flex-wrap items-center justify-end gap-3 border-t px-4 py-2.5"
                  onClick={event => event.stopPropagation()}
                >
                  {props.actions!(item)}
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </>
  );
}
