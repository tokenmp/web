import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import ChevronRight from "lucide-solid/icons/chevron-right";
import KeyRound from "lucide-solid/icons/key-round";
import LogOut from "lucide-solid/icons/log-out";
import { createSignal, For, Show } from "solid-js";

import { VersionLabel } from "~/components/layout/app-shell";
import { Section } from "~/components/panel/section";
import { ThemeToggle } from "~/components/layout/app-shell";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { DecimalSplit } from "~/components/ui/decimal-split";
import { Dialog } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { planModeMeta } from "~/lib/panel-labels";
import { createClientResource } from "~/lib/resource";
import { getCurrentUser } from "~/lib/session";
import {
  changePassword,
  emptyPlans,
  fetchMe,
  fetchPlans,
  resolvePanelPlan,
  type PanelMe,
} from "~/lib/user-panel";
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
function PanelMePage() {
  const user = createAsync(() => getCurrentUser());
  const me = createClientResource<PanelMe | null>(fetchMe, null);
  const plans = createClientResource(fetchPlans, emptyPlans);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/");
  };

  const accountName = () => me.data()?.name ?? user()?.name ?? "未登录";
  const accountEmail = () => me.data()?.email ?? user()?.email ?? "";
  const accountRole = () => me.data()?.role ?? user()?.role;
  const accountCreatedAt = () => me.data()?.created_at ?? user()?.created_at;

  // 后台绑定的套餐（users.plan_id）与用户自助订阅（subscriptions 行）是两回事，
  // 这里把两者合起来，只有绑定、没订阅时也能显示套餐名
  const current = () => resolvePanelPlan(plans.data(), me.data()?.plan_id);
  const budget = () => me.data()?.budget;
  const budgetRate = () => {
    const value = budget();
    if (!value || value.amount <= 0) return 0;
    return value.used / value.amount;
  };
  const quotaRate = () => {
    const value = current()?.subscription;
    if (!value || value.quota_limit <= 0) return 0;
    return value.quota_used / value.quota_limit;
  };

  /* ------------------------------------------------------------ 改密码 */
  const [pwOpen, setPwOpen] = createSignal(false);
  const [oldPassword, setOldPassword] = createSignal("");
  const [newPassword, setNewPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [pwBusy, setPwBusy] = createSignal(false);
  const [pwError, setPwError] = createSignal("");
  const [pwDone, setPwDone] = createSignal(false);

  const openPassword = () => {
    setPwError("");
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPwOpen(true);
  };

  const submitPassword = async () => {
    setPwError("");
    if (!oldPassword()) return setPwError("请先填写原密码");
    if (newPassword().length < 8) return setPwError("新密码至少 8 位");
    if (newPassword() !== confirmPassword()) return setPwError("两次输入的新密码不一致");

    setPwBusy(true);
    try {
      // 成功后后端重写了 cookie，当前这台仍是登录态；其他设备下次请求会被 401
      await changePassword({ old_password: oldPassword(), new_password: newPassword() });
      setPwDone(true);
      setPwOpen(false);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "修改密码失败");
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <>
      <Title>个人中心 | TokenMP 用户面板</Title>


      <div class="grid gap-4 lg:grid-cols-2">
        <Card class="p-5">
          <div class="flex items-center gap-3">
            <span class="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
              {accountName().slice(0, 1).toUpperCase()}
            </span>
            <div class="min-w-0">
              <p class="truncate text-base font-semibold tracking-tight">{accountName()}</p>
              <p class="truncate text-xs text-muted-foreground">
                {accountEmail() || "未设置邮箱"}
              </p>
              <p class="mt-0.5 text-xs text-muted-foreground">
                注册于 {formatDate(accountCreatedAt())}
              </p>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap gap-2">
            <Show
              when={current()}
              fallback={<Badge variant="secondary">未订阅套餐</Badge>}
            >
              <Show
                when={current()!.subscription}
                fallback={<Badge variant="outline">已绑定，未开通周期</Badge>}
              >
                <Badge variant={planModeMeta(current()!.plan.mode).variant}>
                  {planModeMeta(current()!.plan.mode).label}中
                </Badge>
              </Show>
              <Badge variant="secondary">{current()!.plan.name}</Badge>
            </Show>
            <Show when={accountRole() === "admin"}>
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

          <Show
            when={me.data()}
            fallback={
              <p class="mt-3 text-sm text-muted-foreground">{me.error() ?? "加载中…"}</p>
            }
          >
            <p class="mt-3 text-2xl font-semibold tracking-tight">
              <DecimalSplit
                text={formatPoints(me.data()!.balance + me.data()!.credit_available)}
              />
              <span class="ml-1 text-xs font-normal text-muted-foreground">积分</span>
            </p>

            <dl class="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt class="text-muted-foreground">余额</dt>
                <dd class="mt-0.5 font-medium">
                  <DecimalSplit text={formatPoints(me.data()!.balance)} />
                </dd>
              </div>
              <div>
                <dt class="text-muted-foreground">信用额度</dt>
                <dd class="mt-0.5 font-medium">
                  <DecimalSplit text={formatPoints(me.data()!.credit_available)} />
                  <span class="ml-1 text-muted-foreground">
                    / {formatPoints(me.data()!.credit_limit)}
                  </span>
                </dd>
              </div>
            </dl>
          </Show>
        </Card>

        <Card class="p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold">本周期额度</h2>
              <p class="mt-1 text-xs text-muted-foreground">
                {current()
                  ? current()!.subscription
                    ? `${current()!.plan.name} · 周期 ${formatDate(current()!.subscription!.period_start)} – ${formatDate(current()!.subscription!.period_end)}`
                    : `${current()!.plan.name} · 还没有开通周期`
                  : plans.loading() || plans.data().plans.length === 0
                    ? "正在读取当前订阅"
                    : "当前没有进行中的订阅"}
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

          <Show
            when={current()}
            fallback={
              <p class="mt-3 text-sm text-muted-foreground">
                {plans.error() ??
                  (plans.loading() || plans.data().plans.length === 0
                    ? "加载中…"
                    : "到套餐页订阅一档，就有周期额度可用")}
              </p>
            }
          >
            <Show
              when={current()!.subscription}
              fallback={
                <>
                  <p class="mt-3 text-sm text-muted-foreground">还没有周期额度</p>
                  <A
                    href="/panel/plans"
                    class={`${buttonVariants({ variant: "outline" })} mt-3`}
                  >
                    去订阅套餐
                  </A>
                </>
              }
            >
              <div class="mt-3 flex items-center justify-between text-sm">
                <span class="text-muted-foreground">已用</span>
                <span>
                  <DecimalSplit text={formatPoints(current()!.subscription!.quota_used)} /> /{" "}
                  <DecimalSplit text={formatPoints(current()!.subscription!.quota_limit)} />
                </span>
              </div>
              <div
                class="mt-2 h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={Math.round(quotaRate() * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="本周期额度用量"
              >
                <div
                  class="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, quotaRate() * 100)}%` }}
                />
              </div>
              <p class="mt-2 text-xs text-muted-foreground">
                本周期还可调用{" "}
                <DecimalSplit
                  text={formatPoints(
                    current()!.subscription!.quota_limit - current()!.subscription!.quota_used,
                  )}
                />{" "}
                积分 · 超出后按套餐超量策略处理
              </p>
            </Show>
          </Show>
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

      <Section title="服务入口" class="mt-5">
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
            onClick={openPassword}
            class="flex w-full items-center justify-between gap-3 p-4 text-left text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span class="flex items-center gap-2.5">
              <KeyRound class="size-4" aria-hidden="true" />
              修改密码
            </span>
            <ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
          </button>

          <Show when={pwDone()}>
            <p class="border-t px-4 py-3 text-xs text-success-text" role="status">
              密码已更新。其他设备上的会话已失效，需要重新登录；本机不用。
            </p>
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

      <Dialog
        open={pwOpen()}
        onOpenChange={open => {
          if (!open) setPwOpen(false);
        }}
        title="修改密码"
        description="改完后其他设备上的登录会失效，当前这台会重新签发会话，不用重新登录"
        footer={
          <>
            <Button variant="outline" onClick={() => setPwOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void submitPassword()} disabled={pwBusy()}>
              {pwBusy() ? "提交中…" : "确认修改"}
            </Button>
          </>
        }
      >
        <div class="space-y-4">
          <div class="space-y-1.5">
            <Label for="old-password">原密码</Label>
            <Input
              id="old-password"
              type="password"
              autocomplete="current-password"
              value={oldPassword()}
              onInput={event => setOldPassword(event.currentTarget.value)}
            />
          </div>
          <div class="space-y-1.5">
            <Label for="new-password">新密码</Label>
            <Input
              id="new-password"
              type="password"
              autocomplete="new-password"
              value={newPassword()}
              onInput={event => setNewPassword(event.currentTarget.value)}
            />
            <p class="text-xs text-muted-foreground">至少 8 位，与注册时的要求一致</p>
          </div>
          <div class="space-y-1.5">
            <Label for="confirm-password">确认新密码</Label>
            <Input
              id="confirm-password"
              type="password"
              autocomplete="new-password"
              value={confirmPassword()}
              onInput={event => setConfirmPassword(event.currentTarget.value)}
            />
          </div>
          <Show when={pwError()}>
            <p
              class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-text"
              role="alert"
            >
              {pwError()}
            </p>
          </Show>
        </div>
      </Dialog>

      <div class="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <VersionLabel />
      </div>
    </>
  );
}

// 组件名与从 ~/lib/user-panel 导入的 type PanelMe 撞名，所以这里叫 PanelMePage。
// 默认导出放在末尾：写成 `export default function X()` 时 oxc-parser 会把它误判成
// 类型导出，路由扫描会把这一条悄悄丢掉（页面直接 404，构建里一句警告都没有）。
export default PanelMePage;
