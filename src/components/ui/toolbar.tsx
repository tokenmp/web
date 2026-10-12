import Search from "lucide-solid/icons/search";
import { type JSX } from "solid-js";

import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

/**
 * 卡片顶部那一条筛选与操作行。
 *
 * 之前每个页面各写一层 `flex flex-wrap items-center gap-2 border-b p-4`，对齐方式、
 * 间距、控件高度各走各的，摆在一起就参差。四条约束集中在这里，页面照着用就行。
 *
 *   1. 行内控件的标签一律画在控件左边（Select 传 `labelPlacement="inline"`），
 *      不画在控件上方 —— 上方标签只在弹窗和表单里用。
 *   2. 分段控件不给可见标签，靠选项文字和无障碍名说明。
 *   3. 两个分段控件不并排放，中间插 ToolbarDivider，否则两组选项会连成一片。
 *   4. 右边那一组用 ToolbarSpacer 顶开，不要用 `ml-auto`：换行之后 `ml-auto`
 *      会把整行的空白算进去，控件被推出屏幕。
 */
export function Toolbar(props: { children?: JSX.Element; class?: string }) {
  return (
    <div class={cn("flex flex-wrap items-center gap-2 border-b px-4 py-3", props.class)}>
      {props.children}
    </div>
  );
}

/**
 * 把后面的控件推到右边。
 *
 * 手机上也要渲染。原来写成 `hidden sm:block`，理由是怕撑出一行空白，但它的
 * `flex-basis` 是 0，只会占当前那一行剩下的宽度，自己不会换行。藏起来之后，
 * 换行后的那一行左边对齐，右边空出一块 —— 面板密钥页在 390px 下按钮右边空了
 * 29px，跟表头、分页条的 16px 对不上。
 */
export function ToolbarSpacer() {
  return <div class="min-w-0 flex-1" aria-hidden="true" />;
}

/** 两组筛选之间的竖分隔线。用比分隔线深一档的 --input，浅色下也看得见 */
export function ToolbarDivider() {
  return <span class="hidden h-5 w-px shrink-0 self-center bg-input sm:block" aria-hidden="true" />;
}

/**
 * 带放大镜的搜索框。
 *
 * 宽度默认手机占满一行、桌面 14rem，`class` 可以覆盖。图标用 pl-9 让出位置：
 * 图标左边距 12px 加宽 16px 是 28px，文字从 36px 开始，留 8px 的间隔。
 */
export function ToolbarSearch(props: {
  placeholder: string;
  ariaLabel: string;
  value: string;
  onInput: (value: string) => void;
  class?: string;
}) {
  return (
    <div class={cn("relative w-full sm:w-56", props.class)}>
      <Search
        class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        class="pl-9"
        placeholder={props.placeholder}
        aria-label={props.ariaLabel}
        value={props.value}
        onInput={event => props.onInput(event.currentTarget.value)}
      />
    </div>
  );
}
