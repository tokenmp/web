import { createAsync, Navigate, type RouteSectionProps } from "@solidjs/router";
import { Show } from "solid-js";

import { PanelShell } from "~/components/layout/panel-shell";
import { panelNav, panelTabs } from "~/lib/panel-nav";
import { getCurrentUser } from "~/lib/session";

/**
 * 用户面板布局。
 *
 * 跟控制台的 dashboard.tsx 一样用 server function 判登录：SSR 阶段就知道结果，
 * 不会先闪一下面板再跳回登录页。
 *
 * 没做 role 判断 —— 管理员的账号也是普通用户，能看自己的密钥和账单；
 * 线上的 /panel 同样只要求登录（RequireAuth scope="user"）。
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
        <PanelShell nav={panelNav} tabs={panelTabs} fallbackTitle="用户面板" user={user()}>
          {props.children}
        </PanelShell>
      </Show>
    </Show>
  );
}
