import { createAsync, Navigate, type RouteSectionProps } from "@solidjs/router";
import { Show } from "solid-js";

import { AppShell } from "~/components/layout/app-shell";
import { panelNav } from "~/lib/panel-nav";
import { getCurrentUser } from "~/lib/session";

/**
 * 用户面板布局。
 *
 * 跟控制台的 dashboard.tsx 一样用 server function 判登录：SSR 阶段就知道结果，
 * 不会先闪一下面板再跳回登录页。
 *
 * 没做 role 判断 —— 管理员的账号也是普通用户，能看自己的密钥和账单；
 * 线上的 /panel 同样只要求登录（RequireAuth scope="user"）。
 *
 * 外壳跟控制台共用 app-shell.tsx，面板不另写一套：两边只在导航项上不同。
 * 原来面板有一套 panel-shell（md 断点、224px 侧栏、分组导航、五项底栏），
 * 跟控制台摆在一起会有两种布局，现在统一成控制台那一套。
 */
export default function PanelLayout(props: RouteSectionProps) {
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
        <AppShell nav={panelNav} fallbackTitle="用户面板" user={user()}>
          {props.children}
        </AppShell>
      </Show>
    </Show>
  );
}
