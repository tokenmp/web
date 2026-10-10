import Copy from "lucide-solid/icons/copy";
import { createSignal, Show } from "solid-js";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/**
 * 请求 ID 这类标识：等宽显示，右侧带一个复制按钮。
 *
 * 复制失败不做提示 —— 多半是浏览器不给剪贴板权限（非 https 或用户拒绝），
 * 这时候文本就在眼前，手动选中即可，弹一个红字只会打断人。
 */
export function CopyableId(props: { value: string; class?: string; label?: string }) {
  const [copied, setCopied] = createSignal(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <span class={cn("flex items-center gap-1.5", props.class)}>
      <span class="break-all font-mono text-xs">{props.value}</span>
      <Button
        variant="ghost"
        size="icon"
        class="size-6 shrink-0"
        aria-label={props.label ?? `复制 ${props.value}`}
        onClick={copy}
      >
        <Show when={!copied()} fallback={<span class="text-[10px] text-success-text">已复制</span>}>
          <Copy class="size-3.5" />
        </Show>
      </Button>
    </span>
  );
}
