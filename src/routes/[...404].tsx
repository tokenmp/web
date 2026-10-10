import { HttpStatusCode } from "@solidjs/start";
import { Title } from "@solidjs/meta";
import { A } from "@solidjs/router";

import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export default function NotFound() {
  return (
    <main class="grid min-h-dvh place-items-center bg-muted/40 px-6 py-10">
      <HttpStatusCode code={404} />
      <Title>页面不存在 | TokenMP 销售控制台</Title>
      <div class="text-center">
        <p class="text-sm font-medium text-muted-foreground">404</p>
        <h1 class="mt-2 text-2xl font-semibold tracking-tight">页面不存在</h1>
        <p class="mt-2 text-sm text-muted-foreground">地址可能写错了，或者这个页面还没有做。</p>
        <A href="/dashboard" class={cn(buttonVariants(), "mt-6")}>
          回到概览
        </A>
      </div>
    </main>
  );
}
