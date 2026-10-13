import { Title } from "@solidjs/meta";
import { A } from "@solidjs/router";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { createSignal, For, Show } from "solid-js";

import { Delta } from "~/components/panel/delta";
import { ResponsiveTable } from "~/components/panel/responsive-table";
import { UsageChart } from "~/components/panel/usage-chart";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { DecimalSplit } from "~/components/ui/decimal-split";
import { Segmented } from "~/components/ui/segmented";
import { detailText, txSourceMeta } from "~/lib/panel-labels";
import { createClientResource } from "~/lib/resource";
import { getUsage, type UsageSeriesItem } from "~/lib/usage";
import {
  emptyCredits,
  emptyPlans,
  fetchCredits,
  fetchMe,
  fetchPlans,
  resolvePanelPlan,
  type PanelMe,
  type PanelTransaction,
} from "~/lib/user-panel";
import { cn } from "~/lib/utils";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPoints,
  formatRelativeTime,
  formatTokens,
} from "~/lib/utils";

const METRIC_OPTIONS: { value: "tokens" | "revenue"; label: string }[] = [
  { value: "tokens", label: "Token" },
  { value: "revenue", label: "消耗" },
];

/**
 * 面板概览。
 *
 * 一屏回答三个问题：还剩多少、最近用得怎么样、钱的去向。
 * 所以顺序是 KPI 指条 → 用量趋势 → 当前套餐还剩多少 → 最近流水。
 *
 * 全部读本机接口：额度与流水是 /user/credits，用量是 /user/usage，套餐是 /user/plans。
 * 转发内核还没回写记录之前，用量与流水都是空的，这里显示「—」而不是编个数。
 */
export default function PanelOverview() {
  // 后台绑的套餐（users.plan_id）与自助订阅（subscriptions 行）是两回事，两个都要拉
  const plans = createClientResource(fetchPlans, emptyPlans);
  const me = createClientResource<PanelMe | null>(fetchMe, null);
  const credits = createClientResource(() => fetchCredits({ page: 1, size: 5 }), emptyCredits);
  const usage = createClientResource<UsageSeriesItem[]>(() => getUsage(7), []);
  const [metric, setMetric] = createSignal<"tokens" | "revenue">("tokens");

  const current = () => resolvePanelPlan(plans.data(), me.data()?.plan_id);
  /** 序列按天升序，最后一天就是今天；一条都没有时为 null */
  const today = () => usage.data().at(-1) ?? null;
  const totalTokens = () => usage.data().reduce((sum, day) => sum + day.tokens, 0);
  const totalRevenue = () => usage.data().reduce((sum, day) => sum + day.revenue, 0);
  const available = () => {
    const value = me.data();
    return value ? value.balance + value.credit_available : null;
  };
  const quotaRate = () => {
    const value = current()?.subscription;
    if (!value || value.quota_limit <= 0) return 0;
    return value.quota_used / value.quota_limit;
  };

  const kpis = () => [
    {
      label: "可用积分",
      value: available() === null ? "—" : <DecimalSplit text={formatPoints(available()!)} />,
      hint:
        me.data() === null
          ? undefined
          : `余额 ${formatPoints(me.data()!.balance)} · 信用 ${formatPoints(me.data()!.credit_available)}`,
    },
    {
      label: "今日 Token",
      value: today() ? formatTokens(today()!.tokens) : "—",
    },
    {
      label: "近 7 日 Token",
      value: usage.data().length === 0 ? "—" : formatTokens(totalTokens()),
    },
    {
      label: "今日消耗",
      value:
        today() === null ? "—" : <DecimalSplit text={formatPoints(today()!.revenue)} />,
    },
    {
      label: "今日请求",
      value: today() ? formatNumber(today()!.requests) : "—",
      hint: "含失败与重试",
    },
  ];

  return (
    <>
      <Title>概览 | tokenmp web</Title>

      {/* 五格指标条：手机上两列，lg 往上铺成一行 */}
      <div class="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-5">
        <For each={kpis()}>
          {(kpi, index) => (
            <div
              class={cn(
                "bg-card p-3 md:p-4",
                // 五项在两列下会空出半行，让最后一项横跨两列，免得露出一块底色
                index() === kpis().length - 1 && kpis().length % 2 === 1 && "col-span-2 lg:col-span-1",
              )}
              title={kpi.hint}
            >
              <p class="text-xs text-muted-foreground">{kpi.label}</p>
              <p class="mt-1 text-xl font-semibold tracking-tight md:text-2xl">{kpi.value}</p>
            </div>
          )}
        </For>
      </div>

      <div class="mt-5 space-y-5">
        <Card>
          <div class="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div>
              <h2 class="text-sm font-semibold">近 7 日用量</h2>
              <p class="mt-1 text-xs text-muted-foreground">
                {usage.loading() || usage.data().length === 0 ? (
                  "—"
                ) : (
                  <>
                    合计 {formatNumber(totalTokens())} tok · 消耗{" "}
                    <DecimalSplit text={formatPoints(totalRevenue())} /> 积分
                  </>
                )}
              </p>
            </div>
            <Segmented
              options={METRIC_OPTIONS}
              value={metric()}
              onChange={setMetric}
              ariaLabel="用量口径"
            />
          </div>
          <div class="p-4">
            <UsageChart series={usage.data()} metric={metric()} />
          </div>
        </Card>

        <Card>
          <div class="flex flex-wrap items-center justify-between gap-2 border-b p-4">
            <div>
              <h2 class="text-sm font-semibold">当前套餐</h2>
              <p class="mt-1 text-xs text-muted-foreground">
                <Show
                  when={current()}
                  fallback={plans.loading() || me.loading() ? "读取中…" : "还没有绑定套餐"}
                >
                  {current()!.plan.name}
                  <span> · </span>
                  <DecimalSplit text={formatPoints(current()!.plan.price ?? 0)} /> 积分/周期
                </Show>
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

          <div class="p-4">
            <Show
              when={current()?.subscription}
              fallback={
                <>
                  <p class="text-sm text-muted-foreground">还没有周期额度</p>
                  <A
                    href="/panel/plans"
                    class={cn(buttonVariants({ variant: "outline" }), "mt-3")}
                  >
                    去订阅套餐
                  </A>
                </>
              }
            >
              <div class="flex items-center justify-between text-sm">
                <span class="text-muted-foreground">额度已用</span>
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
                aria-label="套餐额度已用"
              >
                <div
                  class="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, quotaRate() * 100)}%` }}
                />
              </div>
              <p class="mt-2 text-xs text-muted-foreground">
                剩余{" "}
                <DecimalSplit
                  text={formatPoints(
                    current()!.subscription!.quota_limit - current()!.subscription!.quota_used,
                  )}
                />{" "}
                积分
                {current()!.subscription!.period_start && current()!.subscription!.period_end && (
                  <>
                    <span> · 周期 </span>
                    {formatDate(current()!.subscription!.period_start)} ~{" "}
                    {formatDate(current()!.subscription!.period_end)}
                  </>
                )}
              </p>
            </Show>
          </div>
        </Card>

        <section>
          <div class="mb-2 flex items-center justify-between">
            <h2 class="text-sm font-medium text-muted-foreground">最近流水</h2>
            <A
              href="/panel/credits"
              class="flex items-center gap-0.5 rounded-md px-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              全部
              <ChevronRight class="size-3.5" aria-hidden="true" />
            </A>
          </div>

          <ResponsiveTable
            items={credits.data().transactions}
            rowKey={(row: PanelTransaction) => row.id}
            columns={[
              {
                header: "来源",
                cell: (row: PanelTransaction) => (
                  <Badge variant={txSourceMeta(row.source).variant}>
                    {txSourceMeta(row.source).label}
                  </Badge>
                ),
              },
              {
                header: "说明",
                cell: (row: PanelTransaction) => detailText(row.detail) ?? row.model ?? "—",
              },
              {
                header: "变动",
                align: "right",
                cell: (row: PanelTransaction) => <Delta value={row.delta} />,
              },
              {
                header: "结余",
                align: "right",
                cell: (row: PanelTransaction) => (
                  <DecimalSplit text={formatPoints(row.balance_after)} />
                ),
              },
              {
                header: "时间",
                cell: (row: PanelTransaction) => (
                  <span title={formatDateTime(row.created_at)}>
                    {formatRelativeTime(row.created_at)}
                  </span>
                ),
              },
            ]}
            cardTitle={(row: PanelTransaction) => row.model ?? txSourceMeta(row.source).label}
            cardSubtitle={(row: PanelTransaction) => (
              <>
                {row.total_tokens ? `${formatNumber(row.total_tokens)} tok · ` : ""}
                {formatRelativeTime(row.created_at)}
              </>
            )}
            cardRight={(row: PanelTransaction) => <Delta value={row.delta} />}
            empty={credits.loading() ? "加载中…" : "暂无流水"}
          />
        </section>
      </div>
    </>
  );
}
