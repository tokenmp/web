import { createAsync, Navigate, type RouteSectionProps } from "@solidjs/router";
import { Show } from "solid-js";

import { AppShell } from "~/components/layout/app-shell";
import { dashboardNav } from "~/lib/nav";
import { getCurrentUser } from "~/lib/session";

export default function DashboardLayout(props: RouteSectionProps) {
  // server function，SSR 阶段就能判断登录状态，不会先闪一下控制台再跳走
  const user = createAsync(() => getCurrentUser());

  return (
    <Show
      when={user() !== undefined}
      fallback={
        <div class="grid min-h-dvh place-items-center text-sm text-muted-foreground">
          正在检查登录状态…
        </div>
      }
    >
      <Show when={user()} fallback={<Navigate href="/" />}>
        <AppShell nav={dashboardNav} fallbackTitle="管理控制台" user={user()}>
          {props.children}
        </AppShell>
      </Show>
    </Show>
  );
}
