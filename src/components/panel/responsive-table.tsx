import Ellipsis from "lucide-solid/icons/ellipsis";
import { createSignal, For, Show, type JSX } from "solid-js";

import { EmptyState } from "~/components/ui/empty-state";
import { Sheet, SheetClose } from "~/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { cn } from "~/lib/utils";

export type PanelColumn<T> = {
  header: string;
  cell: (item: T) => JSX.Element;
  /** 桌面端右对齐。手机上不生效：卡片按主次排，不按表格的列序 */
  align?: "right";
};

/**
 * 列表的两种呈现：桌面端表格，手机端行列表。
 *
 * 手机上的横向滚动表格很难读，所以同一份数据渲染两遍，用 `md:` 切换。
 * 两边都由 CSS 控制，不靠 JS 判断断点 —— 服务端渲染出来的是同一份 DOM，
 * 不会先闪一下表格再跳成卡片。
 *
 * 行操作传一份 `actions`：桌面端自动多出一列直接摆出这些按钮；手机端整行可点，
 * 点开从底部升起一个操作面板，把这几个操作竖向列出来（取消在底部）。手机屏幕窄，
 * 操作直接铺在行里会把一行撑得很长，也容易误触，放进面板里让用户主动触发。
 * 操作里如果本身就是个 Sheet（比如「请求详情」），点它先关掉面板再开详情。
 */
export function ResponsiveTable<T>(props: {  items: T[];
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
  /** 手机端当前展开操作面板的那一行 */
  const [openItem, setOpenItem] = createSignal<T | null>(null);

  /** 手机端一行里的内容：标题、副标题、右侧信息。触发行与普通行共用 */
  const rowContent = (item: T) => (
    <>
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
    </>
  );

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
                  {/* 手机端那份走 EmptyState，title 与 description 都画。
                      这边只画了 title，同一份空态在两个断点下文案不一致 */}
                  <p>{props.empty}</p>
                  <Show when={props.emptyDescription}>
                    <p class="mt-1 text-xs">{props.emptyDescription}</p>
                  </Show>
                </TableCell>
              </TableRow>
            </Show>
          </TableBody>
        </Table>
      </div>

      {/* 手机上的行不再各自画一圈描边与圆角。原来每一行都是 rounded-lg border bg-card，
          套在页面的卡片里面，四行就是四个框套在框里。改成用分隔线连成一张列表，
          跟桌面端表格的行分隔一致；行本身不要底色，绡页面卡片的底。 */}
      <div class="divide-y divide-border md:hidden">
        <Show when={props.items.length === 0}>
          <EmptyState title={props.empty} description={props.emptyDescription} />
        </Show>

        <For each={props.items}>
          {item => (
            <Show
              when={props.actions}
              fallback={
                <div
                  class="flex items-center gap-3 px-4 py-3"
                  onClick={props.onRowClick ? () => props.onRowClick!(item) : undefined}
                  role={props.onRowClick ? "button" : undefined}
                >
                  {rowContent(item)}
                </div>
              }
            >
              {/* 整行是一个按钮，点开底部操作面板。不用 Kobalte 的 Trigger：那样每行
                  都要建一个 Dialog，列表长的时候白建十几个 */}
              <button
                type="button"
                class={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                  "hover:bg-muted/40 active:bg-muted/60",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
                )}
                aria-haspopup="dialog"
                aria-expanded={openItem() === item}
                onClick={() => setOpenItem(() => item)}
              >
                {rowContent(item)}
                <Ellipsis class="size-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
              </button>
            </Show>
          )}
        </For>

        <Sheet
          side="bottom"
          open={openItem() !== null}
          onOpenChange={open => !open && setOpenItem(null)}
          title={openItem() ? props.cardTitle(openItem()!) : ""}
          description={openItem() ? props.cardSubtitle?.(openItem()!) : undefined}
          footer={<SheetClose class="w-full">取消</SheetClose>}
        >
          {/* 点任一项先关面板，再让页面自己的处理走完（比如 「详情」 再开一个详情抽屉） */}
          <div
            class={cn(
              "flex flex-col gap-1",
              // 页面传进来的操作是按钮，这里把它们拉成列表行
              "[&>button]:h-11 [&>button]:w-full [&>button]:justify-start [&>button]:gap-2.5",
              "[&>button]:rounded-lg [&>button]:border-0 [&>button]:bg-transparent",
              "[&>button]:px-3 [&>button]:text-sm [&>button]:font-medium",
              "[&>button:hover]:bg-accent",
            )}
            onClick={() => setOpenItem(null)}
          >
            {openItem() && props.actions!(openItem()!)}
          </div>
        </Sheet>
      </div>
    </>
  );
}
