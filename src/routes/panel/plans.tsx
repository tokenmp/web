import { Title } from "@solidjs/meta";
import { createMemo, createSignal, For, Show } from "solid-js";

import { PageHeader } from "~/components/layout/page-header";
import { Section } from "~/components/panel/section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { DecimalSplit } from "~/components/ui/decimal-split";
import { Dialog } from "~/components/ui/dialog";
import { Select } from "~/components/ui/select";
import { planModeMeta, pricingModeMeta } from "~/lib/panel-labels";
import { createClientResource } from "~/lib/resource";
import { getUsage, type UsageSeriesItem } from "~/lib/usage";
import {
  emptyPlans,
  fetchMe,
  fetchPlans,
  isInsufficientBalance,
  resolvePanelPlan,
  subscribePlan,
  type PanelMe,
  type PanelPlan,
} from "~/lib/user-panel";
import { formatDate, formatNumber, formatPoints } from "~/lib/utils";

/**
 * 周期还剩几天。数据在客户端加载，这里用当前时间算，不参与首屏水合。
 */
function daysLeft(periodEnd: string | null | undefined) {
  if (!periodEnd) return null;
  const end = new Date(periodEnd).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

function quotaLabel(plan: PanelPlan) {
  if (plan.mode === "pay_as_you_go" || plan.quota_amount <= 0) return "按量计费";
  return plan.quota_kind === "requests"
    ? `${formatNumber(plan.quota_amount)} 次`
    : `${formatPoints(plan.quota_amount)} 积分`;
}

/** 接口把 price=null 归零，0 表示没有牌价（按量付费），不是「免费用」 */
function hasPrice(plan: PanelPlan) {
  return plan.mode !== "pay_as_you_go" && plan.price > 0;
}

/**
 * 套餐。
 *
 * 三块：现在订的是什么（含周期额度用了多少）、最近用得怎么样、还能换什么。
 * 列表与当前订阅读 GET /api/user/plans；确认订阅会真的 POST 下单，换档时后端按旧订阅
 * 剩余额度折算抵扣，只补差价，余额不够回 402，这里单独提示「先充值」。
 */
export default function PanelPlans() {
  const { data, loading, error, reload } = createClientResource(fetchPlans, emptyPlans);
  // users.plan_id 单独拉：后台只绑定、没开周期时，当前套餐要靠它才显示得出来
  const me = createClientResource<PanelMe | null>(fetchMe, null);
  const usageTrend = createClientResource<UsageSeriesItem[]>(() => getUsage(7), []);
  const [pending, setPending] = createSignal<PanelPlan | null>(null);
  const [subscribed, setSubscribed] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal("");
  const [subscribing, setSubscribing] = createSignal(false);

  const plans = () => data().plans;
  const current = () => resolvePanelPlan(data(), me.data()?.plan_id);
  const currentPlanId = () => current()?.plan.id ?? null;

  const left = () => daysLeft(current()?.subscription?.period_end);
  const used = () => {
    const value = current()?.subscription;
    if (!value || value.quota_limit <= 0) return 0;
    return value.quota_used / value.quota_limit;
  };

  const usage = createMemo(() => {
    const series = usageTrend.data();
    const today = series.at(-1) ?? null;
    const week = series.reduce(
      (acc, day) => ({ requests: acc.requests + day.requests, revenue: acc.revenue + day.revenue }),
      { requests: 0, revenue: 0 },
    );
    return [
      { label: "今日", requests: today?.requests ?? null, revenue: today?.revenue ?? null },
      { label: "近 7 日", requests: week.requests, revenue: week.revenue },
    ];
  });

  const subscribe = async (plan: PanelPlan) => {
    setNotice("");
    setSubscribed(null);
    setSubscribing(true);
    try {
      await subscribePlan(plan.id);
      setPending(null);
      setSubscribed(plan.name);
      await reload();
    } catch (err) {
      // 402 是「余额不足」，不是通用失败：换成充值提示，别只丢一句请求失败
      setNotice(
        isInsufficientBalance(err)
          ? "余额不足，无法订阅该套餐。请先充值，或改选按量付费。"
          : err instanceof Error
            ? err.message
            : "订阅失败",
      );
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <>
      <Title>套餐 | TokenMP 用户面板</Title>

      <PageHeader />

      <Show when={subscribed()}>
        <p class="mb-4 rounded-lg border border-success/30 bg-success/15 px-4 py-2.5 text-sm text-success-text">
          已订阅「{subscribed()}」
        </p>
      </Show>

      <Show when={notice()}>
        <p class="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive-text" role="alert">
          {notice()}
        </p>
      </Show>
      <Show when={error()}>
        <p class="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive-text" role="alert">
          {error()}
        </p>
      </Show>

      <Show
        when={current()}
        fallback={
          <Card>
            <div class="p-4">
              <h2 class="text-base font-semibold tracking-tight">
                {error() ? "套餐读取失败" : loading() || plans().length === 0 ? "加载中…" : "还没有订阅套餐"}
              </h2>
            </div>
          </Card>
        }
      >
        <Card>
          <div class="flex flex-wrap items-start justify-between gap-3 border-b p-4">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-base font-semibold tracking-tight">{current()!.plan.name}</h2>
                <Show
                  when={current()!.subscription}
                  fallback={<Badge variant="outline">已绑定，未开通周期</Badge>}
                >
                  <Badge variant="success">订阅中</Badge>
                </Show>
                <Badge variant={pricingModeMeta(current()!.plan.pricing_mode).variant}>
                  {pricingModeMeta(current()!.plan.pricing_mode).label}
                  {current()!.plan.markup_multiplier
                    ? ` ×${current()!.plan.markup_multiplier}`
                    : ""}
                </Badge>
              </div>
              <p class="mt-1.5 text-xs text-muted-foreground">
                <Show when={current()!.subscription}>
                  周期 {formatDate(current()!.subscription!.period_start)} –{" "}
                  {formatDate(current()!.subscription!.period_end)}
                  {left() !== null && <span> · 剩余 {left()} 天</span>}
                </Show>
              </p>
            </div>

            <Button variant="outline" onClick={() => setPending(current()!.plan)}>
              更换套餐
            </Button>
          </div>

          <Show when={current()!.subscription}>
            <div class="p-4">
              <div class="flex items-center justify-between text-sm">
                <span class="text-muted-foreground">本周期额度用量</span>
                <span>
                  <DecimalSplit text={formatPoints(current()!.subscription!.quota_used)} /> /{" "}
                  <DecimalSplit text={formatPoints(current()!.subscription!.quota_limit)} />
                </span>
              </div>
              <div
                class="mt-2 h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={Math.round(used() * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="本周期额度用量"
              >
                <div class="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, used() * 100)}%` }} />
              </div>
              <p class="mt-2 text-xs text-muted-foreground">
                剩余{" "}
                <DecimalSplit
                  text={formatPoints(
                    current()!.subscription!.quota_limit - current()!.subscription!.quota_used,
                  )}
                />{" "}
                积分
              </p>
            </div>
          </Show>
        </Card>
      </Show>

      <Card class="mt-5">
        <div class="border-b p-4">
          <h2 class="text-sm font-semibold">用量统计</h2>
        </div>
        <div class="grid grid-cols-2 divide-x divide-border">
          <For each={usage()}>
            {item => (
              <div class="p-4">
                <p class="text-xs text-muted-foreground">{item.label}</p>
                <p class="mt-1 text-lg font-semibold tabular-nums">
                  {item.requests === null ? "—" : formatNumber(item.requests)}{" "}
                  <span class="text-xs font-normal">次</span>
                </p>
                <p class="mt-1 text-xs text-muted-foreground">
                  {item.revenue === null ? (
                    "—"
                  ) : (
                    <>
                      <DecimalSplit text={formatPoints(item.revenue)} /> 积分
                    </>
                  )}
                </p>
              </div>
            )}
          </For>
        </div>
      </Card>

      <Show when={plans().length > 0}>
        <Section title="在售套餐目录" class="mt-5">
          <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <For each={plans()}>
              {plan => {
                const active = () => plan.id === currentPlanId();
                return (
                  <Card class={active() ? "border-primary/60" : undefined}>
                    <div class="flex items-start justify-between gap-2 border-b p-4">
                      <div>
                        <div class="flex flex-wrap items-center gap-2">
                          <h3 class="text-sm font-semibold">{plan.name}</h3>
                          <Badge variant={planModeMeta(plan.mode).variant}>
                            {planModeMeta(plan.mode).label}
                          </Badge>
                        </div>
                        <p class="mt-1.5 text-xs text-muted-foreground">
                          {plan.mode === "pay_as_you_go"
                            ? "零月费 · 按模型标准价从余额扣费"
                            : `含 ${plan.model_count} 个模型 · 超量${plan.overage_mode === "disabled" ? "停止调用" : "转余额计费"}`}
                        </p>
                      </div>
                      <Show when={active()}>
                        <Badge variant="success">使用中</Badge>
                      </Show>
                    </div>

                    <div class="p-4">
                      <p class="text-2xl font-semibold tracking-tight">
                        <Show
                          when={hasPrice(plan)}
                          fallback={<span class="text-base">按量付费</span>}
                        >
                          <DecimalSplit text={formatPoints(plan.price)} />
                          <span class="ml-1 text-xs font-normal text-muted-foreground">
                            积分 / {plan.quota_period_days || "—"} 天
                          </span>
                        </Show>
                      </p>

                      <dl class="mt-3 space-y-1.5 text-xs">
                        <div class="flex justify-between gap-3">
                          <dt class="text-muted-foreground">
                            {plan.quota_kind === "requests" ? "周期点数" : "周期额度"}
                          </dt>
                          <dd class="font-medium tabular-nums">{quotaLabel(plan)}</dd>
                        </div>
                        <div class="flex justify-between gap-3">
                          <dt class="text-muted-foreground">计价方式</dt>
                          <dd class="font-medium">
                            {plan.pricing_mode === "table"
                              ? "全模型标准价"
                              : `标准价 ×${plan.markup_multiplier ?? 1}`}
                          </dd>
                        </div>
                        <div class="flex justify-between gap-3">
                          <dt class="text-muted-foreground">超量策略</dt>
                          <dd class="font-medium">
                            {plan.overage_mode === "disabled" ? "停止调用" : "转余额按量计费"}
                          </dd>
                        </div>
                        <Show when={plan.quota_kind === "requests" && plan.weight_max > 0}>
                          <div class="flex justify-between gap-3">
                            <dt class="text-muted-foreground">权重区间</dt>
                            <dd class="font-medium tabular-nums">
                              {plan.weight_min} – {plan.weight_max}
                            </dd>
                          </div>
                        </Show>
                      </dl>

                      <Button
                        class="mt-4 w-full"
                        variant={active() ? "outline" : "default"}
                        disabled={active()}
                        onClick={() => setPending(plan)}
                      >
                        {active()
                          ? "当前套餐"
                          : plan.mode === "pay_as_you_go"
                            ? "切换到此套餐"
                            : "立即订阅"}
                      </Button>
                    </div>
                  </Card>
              );
            }}
          </For>
          </div>
        </Section>
      </Show>

      <div class="mt-5 space-y-1.5 text-xs text-muted-foreground">
        <p>
          <span class="font-medium text-foreground">额度口径</span>
          ：额度包的额度是「按本套餐价格计算的消费金额」。每笔请求按套餐倍率计价后，
          先扣周期额度，再扣账户余额。
        </p>
        <p>
          <span class="font-medium text-foreground">按次口径</span>
          ：Coding Plan 的额度是点数，每次成功请求按模型权重扣减（失败不计费），
          点数用尽后转余额按模型单价计费。
        </p>
        <p>
          <span class="font-medium text-foreground">周期滚动</span>
          ：周期自本周期内首笔请求起算，到期自动重置，未用部分不结转。
        </p>
        <p>
          <span class="font-medium text-foreground">切换套餐</span>
          ：确认后立即从余额扣一次周期费用，新套餐额度从新周期起算；余额不足会提示先充值。
        </p>
      </div>

      <Dialog
        open={pending() !== null}
        onOpenChange={open => {
          if (!open) setPending(null);
        }}
        title={`订阅「${pending()?.name ?? ""}」？`}
        description="切换后立即从余额扣周期费用，新套餐额度从新周期起算"
        footer={
          <>
            <Button variant="outline" onClick={() => setPending(null)}>
              取消
            </Button>
            <Button
              disabled={pending()?.id === currentPlanId() || subscribing()}
              onClick={() => pending() && void subscribe(pending()!)}
            >
              {pending()?.id === currentPlanId()
                ? "已是当前套餐"
                : subscribing()
                  ? "提交中…"
                  : "确认订阅"}
            </Button>
          </>
        }
      >
        <Show when={pending()}>
          <Select
            label="目标套餐"
            options={plans().map(plan => ({ value: String(plan.id), label: plan.name }))}
            value={String(pending()!.id)}
            onChange={id =>
              setPending(plans().find(plan => plan.id === Number(id)) ?? null)
            }
            portal={false}
          />

          <dl class="mt-4 space-y-2 text-sm">
            <div class="flex justify-between gap-3">
              <dt class="text-muted-foreground">周期费用</dt>
              <dd class="font-medium tabular-nums">
                {hasPrice(pending()!)
                  ? `${formatPoints(pending()!.price)} 积分`
                  : "按量计费"}
              </dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-muted-foreground">周期额度</dt>
              <dd class="font-medium tabular-nums">{quotaLabel(pending()!)}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-muted-foreground">周期长度</dt>
              <dd class="font-medium tabular-nums">
                {pending()!.quota_period_days || "—"} 天
              </dd>
            </div>
          </dl>
          <p class="mt-3 text-xs text-muted-foreground">
            确认后立即从余额扣一次周期费用；余额不足时接口返回 402，这里会提示先充值。
          </p>
        </Show>
      </Dialog>
    </>
  );
}
