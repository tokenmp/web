import { Switch as KSwitch } from "@kobalte/core/switch";
import { Show } from "solid-js";

import { cn } from "~/lib/utils";

/**
 * 开关。
 *
 * Kobalte 的 Switch 会把一个真实的 checkbox 藏在 Control 里，键盘操作、
 * 焦点环、读屏的开关语义都由它负责，这里只套样式 —— 自己拿 button 画一个
 * 圆点开关，读屏那边就只是一个按钮，说不出「开着的」还是「关着的」。
 */
export function Switch(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  ariaLabel?: string;
  title?: string;
  class?: string;
}) {
  return (
    <KSwitch
      checked={props.checked}
      onChange={props.onChange}
      disabled={props.disabled}
      title={props.title}
      class={cn("flex items-center gap-2", props.class)}
    >
      <KSwitch.Input aria-label={props.ariaLabel ?? props.label} />
      <KSwitch.Control class="inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent bg-input px-0.5 transition-colors data-[checked]:bg-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        <KSwitch.Thumb class="block size-4 rounded-full bg-card shadow-sm transition-transform data-[checked]:translate-x-4" />
      </KSwitch.Control>
      <Show when={props.label}>
        <KSwitch.Label class="text-xs text-muted-foreground">{props.label}</KSwitch.Label>
      </Show>
    </KSwitch>
  );
}
