import { splitProps, type ComponentProps } from "solid-js";

import { cn } from "~/lib/utils";

/** 表格外壳：窄屏时横向滚动，不把单元格挤成多行 */
export function Table(props: ComponentProps<"div"> & { class?: string; tableClass?: string; children?: unknown }) {
  const [local, others] = splitProps(props, ["class", "tableClass", "children"]);
  return (
    <div class={cn("w-full overflow-x-auto", local.class)} {...others}>
      <table class={cn("w-full min-w-[640px] caption-bottom text-sm", local.tableClass)}>
        {local.children}
      </table>
    </div>
  );
}

export function TableHeader(props: ComponentProps<"thead"> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);
  return <thead class={cn("bg-muted/50 text-muted-foreground [&_tr]:border-b", local.class)} {...others} />;
}

export function TableBody(props: ComponentProps<"tbody"> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);
  return <tbody class={cn("[&_tr:last-child]:border-0", local.class)} {...others} />;
}

export function TableRow(props: ComponentProps<"tr"> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <tr
      class={cn("border-b transition-colors hover:bg-muted/40", local.class)}
      {...others}
    />
  );
}

export function TableHead(props: ComponentProps<"th"> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <th
      class={cn("whitespace-nowrap px-5 py-2.5 text-left align-middle font-medium", local.class)}
      {...others}
    />
  );
}

export function TableCell(props: ComponentProps<"td"> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);
  return <td class={cn("px-5 py-3 align-middle", local.class)} {...others} />;
}
