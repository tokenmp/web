import { HttpStatusCode } from "@solidjs/start";
import { Title } from "@solidjs/meta";
import { A } from "@solidjs/router";

import { AppShell } from "~/components/layout/app-shell";
import { buttonVariants } from "~/components/ui/button";
import { dashboardNav } from "~/lib/nav";
import { cn } from "~/lib/utils";

/**
 * 未匹配的地址也留在控制台外壳里：侧边栏和顶栏还在，用户点错了能直接换一条路走，
 * 不会掉进一个没有出口的空白页。状态码仍然是 404。
 */
export default function NotFound() {
  return (
    <AppShell nav={dashboardNav} fallbackTitle="页面不存在">
      <HttpStatusCode code={404} />
      <Title>页面不存在 | TokenMP 销售控制台</Title>

      <div class="grid min-h-[55vh] place-items-center">
        <div class="max-w-sm text-center">
          <p class="text-sm font-medium text-muted-foreground">404</p>
          <h1 class="mt-2 text-2xl font-semibold tracking-tight">页面不存在</h1>
          <p class="mt-2 text-sm text-muted-foreground">
            地址可能写错了，或者这个页面还没有做。左边的导航都还能用。
          </p>
          <div class="mt-6 flex justify-center gap-2">
            <A href="/dashboard" class={cn(buttonVariants())}>
              回到概览
            </A>
            <A href="/design" class={cn(buttonVariants({ variant: "outline" }))}>
              看设计系统
            </A>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
