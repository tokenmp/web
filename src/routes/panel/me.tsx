import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import ChevronRight from "lucide-solid/icons/chevron-right";
import LogOut from "lucide-solid/icons/log-out";
import { For, Show } from "solid-js";

import { VersionLabel } from "~/components/layout/app-shell";
import { PageHeader } from "~/components/layout/page-header";
import { Section } from "~/components/panel/section";
import { ThemeToggle } from "~/components/layout/app-shell";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { DecimalSplit } from "~/components/ui/decimal-split";
import { currentPlan, panelMe } from "~/lib/panel-data";
import { planModeMeta } from "~/lib/panel-labels";
import { getCurrentUser } from "~/lib/session";
import { BUDGET_PERIOD_LABEL, formatDate, formatPoints, formatYuan } from "~/lib/utils";

const SERVICE_LINKS = [
  { href: "/panel/credits", label: "余额明细", hint: "每一笔扣款与充值" },
  { href: "/panel/billing", label: "账单流水", hint: "调用花了多少" },
  { href: "/panel/keys", label: "我的密钥", hint: "新建与吊销 API Key" },
  { href: "/panel/plans", label: "套餐", hint: "订阅与额度" },
  { href: "/panel/accounts", label: "我的账号", hint: "分享上游账号换分成" },
  { href: "/panel/channels", label: "我的渠道", hint: "申请与渠道组" },
  { href: "/panel/models", label: "模型目录", hint: "可用模型与价格" },
];

/**
 * 个人中心。
 *
 * 面板里唯一放「关于我」的地方：账户、额度、预算、偏好，以及登出。
 * 手机端的顶栏只有一个标题和一个铃铛，登出与换主题收在这里 ——
 * 线上也是这么分的（登出不放顶栏）。
 */
export default function PanelMe() {
  const user = createAsync(() => getCurrentUser());

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/");
  };

  const budget = () => panelMe.budget;
  const budgetRate = () => {
    const value = budget();
    if (!value || value.amount <= 0) return 0;
    return value.used / value.amount;
  };

  return (
    <>
      <Title>个人中心 | TokenMP 用户面板</Title>

      <PageHeader description="账户信息、额度与偏好" />

      <div class="grid gap-4 lg:grid-cols-2">
        <Card class="p-5">
          <div class="flex items-center gap-3">
            <span class="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
              {(user()?.name ?? "U").slice(0, 1).toUpperCase()}
            </span>
            <div class="min-w-0">
              <p class="truncate text-base font-semibold tracking-tight">
                {user()?.name ?? "未登录"}
              </p>
              <p class="truncate text-xs text-muted-foreground">
                {user()?.email ?? "未设置邮箱"}
              </p>
              <p class="mt-0.5 text-xs text-muted-foreground">
                注册于 {formatDate(user()?.created_at ?? panelMe.created_at)}
              </p>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap gap-2">
            <Badge variant={planModeMeta(currentPlan.plan.mode).variant}>
              {planModeMeta(currentPlan.plan.mode).label}中
            </Badge>
            <Badge variant="secondary">{currentPlan.plan.name}</Badge>
            <Show when={user()?.role === "admin"}>
              <Badge variant="outline">管理员</Badge>
            </Show>
          </div>
        </Card>

        <Card class="p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold">可用额度</h2>
              <p class="mt-1 text-xs text-muted-foreground">余额 + 剩余信用</p>
            </div>
            <A
              href="/panel/credits"
              class="flex items-center gap-0.5 rounded-md px-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              余额明细
              <ChevronRight class="size-3.5" aria-hidden="true" />
            </A>
          </div>

          <p class="mt-3 text-2xl font-semibold tracking-tight">
            <DecimalSplit text={formatPoints(panelMe.balance + panelMe.credit_available)} />
            <span class="ml-1 text-xs font-normal text-muted-foreground">积分</span>
          </p>

          <dl class="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt class="text-muted-foreground">余额</dt>
              <dd class="mt-0.5 font-medium">
                <DecimalSplit text={formatPoints(panelMe.balance)} />
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">信用额度</dt>
              <dd class="mt-0.5 font-medium">
                <DecimalSplit text={formatPoints(panelMe.credit_available)} />
                <span class="ml-1 text-muted-foreground">
                  / {formatPoints(panelMe.credit_limit)}
                </span>
              </dd>
            </div>
          </dl>
        </Card>

        <Card class="p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold">本周期额度</h2>
              <p class="mt-1 text-xs text-muted-foreground">
                {currentPlan.plan.name} · 周期{" "}
                {formatDate(currentPlan.period_start)} – {formatDate(currentPlan.period_end)}
              </p>
            </div>
            <A
              href="/panel/plans"
              class="flex items-center gap-0.5 rounded-md px-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              套餐
              <ChevronRight class="size-3.5" aria-hidden="true" />
            </A>
          </div>

          <div class="mt-3 flex items-center justify-between text-sm">
            <span class="text-muted-foreground">已用</span>
            <span>
              <DecimalSplit text={formatPoints(currentPlan.quota_used)} /> /{" "}
              <DecimalSplit text={formatPoints(currentPlan.quota_limit)} />
            </span>
          </div>
          <div
            class="mt-2 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round((currentPlan.quota_used / currentPlan.quota_limit) * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="本周期额度用量"
          >
            <div
              class="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, (currentPlan.quota_used / currentPlan.quota_limit) * 100)}%` }}
            />
          </div>
          <p class="mt-2 text-xs text-muted-foreground">
            本周期还可调用{" "}
            <DecimalSplit
              text={formatPoints(currentPlan.quota_limit - currentPlan.quota_used)}
            />{" "}
            积分 · 超出后按套餐超量策略处理
          </p>
        </Card>

        <Card class="p-5">
          <h2 class="text-sm font-semibold">
            预算（{BUDGET_PERIOD_LABEL[budget()?.period ?? "month"] ?? "每月"}）
          </h2>
          <Show
            when={budget()}
            fallback={<p class="mt-2 text-sm text-muted-foreground">未设置预算，余额不足时才停止调用</p>}
          >
            <div class="mt-3 flex items-center justify-between text-sm">
              <span class="text-muted-foreground">
                已用 {formatYuan(budget()!.used)} / {formatYuan(budget()!.amount)}
              </span>
              <span class="tabular-nums">剩余 {formatYuan(budget()!.remaining)}</span>
            </div>
            <div
              class="mt-2 h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={Math.round(budgetRate() * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="预算已用"
            >
              <div
                class="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, budgetRate() * 100)}%` }}
              />
            </div>
            <p class="mt-2 text-xs text-muted-foreground">
              超出预算后调用会返回 403，需要到「我的」里调整预算或等下一个周期。
            </p>
          </Show>
        </Card>
      </div>

      <Section title="服务入口" caption="明细、分享这些独立页从这里进" class="mt-5">
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <For each={SERVICE_LINKS}>
            {link => (
              <A
                href={link.href}
                class="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium">{link.label}</span>
                  <span class="block truncate text-xs text-muted-foreground">{link.hint}</span>
                </span>
                <ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </A>
            )}
          </For>
        </div>
      </Section>

      <Section title="偏好与账户" class="mt-5">
        <Card class="divide-y">
          <div class="flex items-center justify-between gap-3 p-2">
            <span class="pl-2 text-sm text-muted-foreground">外观</span>
            <div class="w-40">
              <ThemeToggle />
            </div>
          </div>

          <Show when={user()?.role === "admin"}>
            <A
              href="/dashboard"
              class="flex items-center justify-between gap-3 p-4 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              运营后台
              <ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
            </A>
          </Show>

          <button
            type="button"
            onClick={logout}
            class="flex w-full items-center gap-2.5 p-4 text-left text-sm font-medium text-destructive-text transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <LogOut class="size-4" aria-hidden="true" />
            退出登录
          </button>
        </Card>
      </Section>

      <div class="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>积分口径 1 元 = 10000 积分。余额与信用按元存储，这里换算成积分显示。</p>
        <VersionLabel />
      </div>
    </>
  );
}
