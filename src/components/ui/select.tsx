import { Select as KSelect } from "@kobalte/core/select";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { Show } from "solid-js";

import { cn } from "~/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

/**
 * 下拉选择。
 *
 * 用 Kobalte 的 Select 原语：触发器是带 aria-haspopup 的按钮、弹出层是 listbox，
 * 键盘（上下键、Home/End、首字母定位）、读屏口播、点外面关闭都由它负责，
 * 这里只管两件事 —— 把取值口径收成「选项值字符串」，以及套设计令牌的样式。
 *
 * 为什么自己再包一层：Kobalte 的 value/onChange 收发的是**选项对象**，
 * 页面里到处做 find/map 太啰嗦。对外只暴露 string | null（null = 未选、显示 placeholder），
 * 对象与字符串的换算收在这一个组件里。
 *
 * 三处 Kobalte + Solid 的坑，都在这个文件里踩过一遍：
 *   1. 触发器与弹层不能写成组件体里的常量（`const trigger = <KSelect.Trigger/>`）。
 *      Solid 的 JSX 是立即求值的，那样会在 KSelect 建好 context 之前就把它们创建出来，
 *      报 useSelectContext / useFormControlContext 找不到。写成子组件、写在 JSX 里，
 *      让它们在 context 之内按需求值。
 *   2. 放在 Dialog 里要传 `portal={false}`：对话框会给「内容之外」的东西加 aria-hidden、
 *      还把焦点锁在对话框内，弹层挂到 body 会被挡在外面（连读屏都读不到）。
 *   3. 标签交给这个组件渲染（label 属性），不要调用方自己写 `<Label for>` ——
 *      触发器的 id 由组件内部生成，自己写 for 拼不上；Kobalte 只认它自己注册的标签 id。
 */
export function Select(props: {
  options: SelectOption[];
  /** 当前选中项的值。null 表示未选，显示 placeholder */
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  /**
   * 可见标签。Kobalte 会把标签的 id 拼进触发器的 aria-labelledby，
   * 读屏才会念「目标渠道组，知远分享的 OpenAI 池」。
   */
  label?: string;
  /** 标签位置：top 占一行（表单里），inline 跟触发器同行（工具栏里） */
  labelPlacement?: "top" | "inline";
  disabled?: boolean;
  /** 触发器的宽度等 */
  class?: string;
  /** 弹层挂到 body（默认）。Dialog 里要传 false */
  portal?: boolean;
}) {
  const selected = () => props.options.find(option => option.value === props.value) ?? null;
  const inline = () => props.labelPlacement === "inline";

  return (
    <KSelect<SelectOption>
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      optionDisabled="disabled"
      value={selected()}
      onChange={option => {
        if (option) props.onChange(option.value);
      }}
      placeholder={props.placeholder}
      disabled={props.disabled}
      gutter={4}
      // 弹层跟触发器同宽；选项文字更长时由内容自己撑开
      sameWidth
      itemComponent={itemProps => (
        <KSelect.Item
          item={itemProps.item}
          class={cn(
            "relative flex cursor-pointer select-none items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
            "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
            "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
          )}
        >
          <KSelect.ItemLabel class="truncate">{itemProps.item.rawValue.label}</KSelect.ItemLabel>
          <KSelect.ItemIndicator>
            <Check class="size-4 shrink-0" aria-hidden="true" />
          </KSelect.ItemIndicator>
        </KSelect.Item>
      )}
    >
      <Show
        when={props.label}
        fallback={<SelectTrigger class={props.class} disabled={props.disabled} />}
      >
        <div class={cn(inline() && "flex items-center gap-2")}>
          <KSelect.Label
            class={cn(
              inline() ? "shrink-0 text-sm text-muted-foreground" : "mb-1.5 block text-sm font-medium",
            )}
          >
            {props.label}
          </KSelect.Label>
          <SelectTrigger class={props.class} disabled={props.disabled} />
        </div>
      </Show>

      {props.portal === false ? (
        <SelectPopup />
      ) : (
        <KSelect.Portal>
          <SelectPopup />
        </KSelect.Portal>
      )}
    </KSelect>
  );
}

/** 触发器。单独写成组件的原因见文件开头第 1 条 */
function SelectTrigger(props: { class?: string; disabled?: boolean }) {
  return (
    <KSelect.Trigger
      class={cn(
        // 跟 Input 同一套尺寸，工具栏里并排不会高矮不齐
        "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors sm:h-9",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        props.class,
      )}
    >
      <KSelect.Value<SelectOption> class="truncate data-[placeholder-shown]:text-muted-foreground">
        {state => state.selectedOption().label}
      </KSelect.Value>
      <KSelect.Icon>
        <ChevronDown class="size-4 shrink-0 opacity-60" aria-hidden="true" />
      </KSelect.Icon>
    </KSelect.Trigger>
  );
}

/** 选项面板。单独写成组件的原因同上 */
function SelectPopup() {
  return (
    <KSelect.Content class="animate-panel-fade-in z-50 max-h-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md focus:outline-none">
      <KSelect.Listbox class="max-h-72 overflow-y-auto p-1" />
    </KSelect.Content>
  );
}
