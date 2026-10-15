import { splitProps, type ComponentProps } from "solid-js";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-card hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // 默认尺寸与输入框、下拉触发器、分段控件同高：手机 40px、桌面 36px
        // （DESIGN.md「控件高度」）。少了 sm: 这一档，工具条里的按钮在手机上会比
        // 旁边的输入框矮 4px。
        default: "h-10 px-4 py-2 sm:h-9",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-md px-8 sm:h-10",
        icon: "size-10 sm:size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    class?: string;
  };

export function Button(props: ButtonProps) {
  const [local, others] = splitProps(props, ["class", "variant", "size"]);
  return (
    <button
      class={cn(buttonVariants({ variant: local.variant, size: local.size }), local.class)}
      {...others}
    />
  );
}

export { buttonVariants };
