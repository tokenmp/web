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
import {
  currentPlan,
  panelNow,
  planViews,
  usageSeries,
  type CurrentPlan,
  type PlanView,
} from "~/lib/panel-data";
import { planModeMeta, pricingModeMeta } from "~/lib/panel-labels";
import { formatDate, formatNumber, formatPoints } from "~/lib/utils";

/** 周期还剩几天。按固定的样例时间算，服务端与浏览器得出一致的结果 */
function daysLeft(current: CurrentPlan) {
  if (!current.period_end) return null;
  const end = new Date(current.period_end).getTime();
  return Math.max(0, Math.ceil((end - panelNow) / 86_400_000));
}

function quotaLabel(plan: PlanView) {
  if (plan.quota_amount == null) return "按量计费";
  return plan.quota_kind === "requests"
    ? `${formatNumber(plan.quota_amount)} 次`
    : `${formatPoints(plan.quota_amount)} 积分`;
}

/**
 * 套餐。
 *
 * 三块：现在订的是什么（含周期额度用了多少）、最近用得怎么样、还能换什么。
 * 换套餐的确认弹窗里写清「切换后立即按新套餐计价」，这是用户最容易误解的地方 ——
 * 线上是管理员操作，本机先做个入口，把交互路径定下来。
 */
export default function PanelPlans() {
  const [pending, setPending] = createSignal<PlanView | null>(null);
  const [subscribed, setSubscribed] = createSignal<string | null>(null);

  const left = () => daysLeft(currentPlan);
  const used = () => currentPlan.quota_used / currentPlan.quota_limit;

  const usage = createMemo(() => {
    const today = usageSeries[usageSeries.length - 1];
    const week = usageSeries.reduce(
      (acc, day) => ({ requests: acc.requests + day.requests, revenue: acc.revenue + day.revenue }),
      { requests: 0, revenue: 0 },
    );
    return [
      { label: "今日", requests: today.requests, revenue: today.revenue },
      { label: "本周", requests: week.requests, revenue: week.revenue },
      // 本月按 4.2 周估：示例数据只有 7 天，写死一个量级就够了
      { label: "本月", requests: Math.round(week.requests * 4.2), revenue: week.revenue * 4.2 },
    ];
  });

  const subscribe = (plan: PlanView) => {
    setSubscribed(plan.name);
    setPending(null);
  };

  return (
    <>
      <Title>套餐 | TokenMP 用户面板</Title>

      <PageHeader description="当前订阅、额度用量与在售套餐目录" />

      <Show when={subscribed()}>
        <p class="mb-4 rounded-lg border border-success/30 bg-success/15 px-4 py-2.5 text-sm text-success-text">
          已提交订阅「{subscribed()}」，本机是示例数据，没有真的下单。
        </p>
      </Show>

      <Card>
        <div class="flex flex-wrap items-start justify-between gap-3 border-b p-4">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-base font-semibold tracking-tight">{currentPlan.plan.name}</h2>
              <Badge variant="success">订阅中</Badge>
              <Badge variant={pricingModeMeta(currentPlan.plan.pricing_mode).variant}>
                {pricingModeMeta(currentPlan.plan.pricing_mode).label}
                {currentPlan.plan.markup_multiplier
                  ? ` ×${currentPlan.plan.markup_multiplier}`
                  : ""}
              </Badge>
            </div>
            <p class="mt-1.5 text-xs text-muted-foreground">
              周期 {formatDate(currentPlan.period_start)} – {formatDate(currentPlan.period_end)}
              {left() !== null && <span> · 剩余 {left()} 天</span>}
            </p>
          </div>

          <Button variant="outline" onClick={() => setPending(currentPlan.plan)}>
            更换套餐
          </Button>
        </div>

        <div class="p-4">
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">本周期额度用量</span>
            <span>
              <DecimalSplit text={formatPoints(currentPlan.quota_used)} /> /{" "}
              <DecimalSplit text={formatPoints(currentPlan.quota_limit)} />
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
              text={formatPoints(currentPlan.quota_limit - currentPlan.quota_used)}
            />{" "}
            积分 · 到期后额度自动重置，未用部分不结转
          </p>
        </div>
      </Card>

      <Card class="mt-5">
        <div class="border-b p-4">
          <h2 class="text-sm font-semibold">用量统计</h2>
          <p class="mt-1 text-xs text-muted-foreground">按成功计费的请求统计</p>
        </div>
        <div class="grid grid-cols-3 gap-px bg-border">
          <For each={usage()}>
            {item => (
              <div class="bg-card p-4">
                <p class="text-xs text-muted-foreground">{item.label}</p>
                <p class="mt-1 text-lg font-semibold tabular-nums">
                  {formatNumber(item.requests)} <span class="text-xs font-normal">次</span>
                </p>
                <p class="mt-1 text-xs text-muted-foreground">
                  <DecimalSplit text={formatPoints(item.revenue)} /> 积分
                </p>
              </div>
            )}
          </For>
        </div>
      </Card>

      <Section title="在售套餐目录" caption="切换后即时生效，新套餐额度从新周期起算" class="mt-5">
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <For each={planViews}>
            {plan => {
              const active = () => plan.id === currentPlan.plan.id;
              return (
                <Card class={active() ? "border-primary/60 shadow-md" : undefined}>
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
                      {plan.price == null ? (
                        <span class="text-base">面议</span>
                      ) : (
                        <>
                          <DecimalSplit text={formatPoints(plan.price)} />
                          <span class="ml-1 text-xs font-normal text-muted-foreground">
                            积分 / {plan.quota_period_days ?? "—"} 天
                          </span>
                        </>
                      )}
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
                      <Show when={plan.quota_kind === "requests" && plan.weight_min != null}>
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
                      {active() ? "当前套餐" : plan.price == null ? "联系定制" : "立即订阅"}
                    </Button>
                  </div>
                </Card>
              );
            }}
          </For>
        </div>
      </Section>

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
          ：切换后立即按新套餐计价，新套餐额度从新周期起算。线上由平台管理员操作。
        </p>
      </div>

      <Dialog
        open={pending() !== null}
        onOpenChange={open => {
          if (!open) setPending(null);
        }}
        title={`订阅「${pending()?.name ?? ""}」？`}
        description="切换后立即按新套餐计价，新套餐额度从新周期起算"
        footer={
          <>
            <Button variant="outline" onClick={() => setPending(null)}>
              取消
            </Button>
            <Button
              disabled={pending()?.id === currentPlan.plan.id}
              onClick={() => subscribe(pending()!)}
            >
              {pending()?.id === currentPlan.plan.id ? "已是当前套餐" : "确认订阅"}
            </Button>
          </>
        }
      >
        <Show when={pending()}>
          <Select
            label="目标套餐"
            options={planViews.map(plan => ({ value: String(plan.id), label: plan.name }))}
            value={String(pending()!.id)}
            onChange={id =>
              setPending(planViews.find(plan => plan.id === Number(id)) ?? null)
            }
            portal={false}
          />

          <dl class="mt-4 space-y-2 text-sm">
            <div class="flex justify-between gap-3">
              <dt class="text-muted-foreground">周期费用</dt>
              <dd class="font-medium tabular-nums">
                {pending()!.price == null ? "面议" : `${formatPoints(pending()!.price!)} 积分`}
              </dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-muted-foreground">周期额度</dt>
              <dd class="font-medium tabular-nums">{quotaLabel(pending()!)}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-muted-foreground">周期长度</dt>
              <dd class="font-medium tabular-nums">
                {pending()!.quota_period_days ?? "—"} 天
              </dd>
            </div>
          </dl>
          <p class="mt-3 text-xs text-muted-foreground">
            本机没有接支付与订阅接口，这里只到确认这一步。
          </p>
        </Show>
      </Dialog>
    </>
  );
}
