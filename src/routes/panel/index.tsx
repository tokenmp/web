import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { createSignal, For } from "solid-js";

import { Delta } from "~/components/panel/delta";
import { ResponsiveTable } from "~/components/panel/responsive-table";
import { UsageChart } from "~/components/panel/usage-chart";
import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { DecimalSplit } from "~/components/ui/decimal-split";
import { Segmented } from "~/components/ui/segmented";
import {
  availablePoints,
  currentPlan,
  panelCredits,
  panelMe,
  usageSeries,
  type BalanceTransaction,
} from "~/lib/panel-data";
import { txSourceMeta } from "~/lib/panel-labels";
import { getCurrentUser } from "~/lib/session";
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
 * 数据本机还没有（接口在 openapi.yaml 的 UserPanel 一组里，本地未实现），
 * 先用 panel-data 的示例数据把版式定下来。
 */
export default function PanelOverview() {
  const user = createAsync(() => getCurrentUser());
  const [metric, setMetric] = createSignal<"tokens" | "revenue">("tokens");

  const today = () => usageSeries[usageSeries.length - 1];
  const totalTokens = () => usageSeries.reduce((sum, day) => sum + day.tokens, 0);
  const totalRevenue = () => usageSeries.reduce((sum, day) => sum + day.revenue, 0);
  const recent = () => panelCredits.transactions.slice(0, 5);
  const quotaRate = () =>
    currentPlan.quota_limit > 0 ? currentPlan.quota_used / currentPlan.quota_limit : 0;

  const kpis = () => [
    {
      label: "可用积分",
      value: <DecimalSplit text={formatPoints(availablePoints())} />,
      hint: `余额 ${formatPoints(panelMe.balance)} · 信用 ${formatPoints(panelMe.credit_available)}`,
    },
    {
      label: "今日 Token",
      value: formatTokens(today().tokens),
      hint: `${formatNumber(today().tokens)} tok`,
    },
    {
      label: "近 7 日 Token",
      value: formatTokens(totalTokens()),
      hint: `${formatNumber(totalTokens())} tok`,
    },
    {
      label: "今日消耗",
      value: <DecimalSplit text={formatPoints(today().revenue)} />,
      hint: `${formatPoints(today().revenue)} 积分`,
    },
    { label: "今日请求", value: formatNumber(today().requests), hint: "含失败与重试" },
  ];

  return (
    <>
      <Title>概览 | TokenMP 用户面板</Title>

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
                合计 {formatNumber(totalTokens())} tok · 消耗{" "}
                <DecimalSplit text={formatPoints(totalRevenue())} /> 积分
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
            <UsageChart series={usageSeries} metric={metric()} />
          </div>
        </Card>

        <Card>
          <div class="flex flex-wrap items-center justify-between gap-2 border-b p-4">
            <div>
              <h2 class="text-sm font-semibold">当前套餐</h2>
              <p class="mt-1 text-xs text-muted-foreground">
                {currentPlan.plan.name}
                <span> · </span>
                <DecimalSplit text={formatPoints(currentPlan.plan.price ?? 0)} /> 积分/周期
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
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">额度已用</span>
              <span>
                <DecimalSplit text={formatPoints(currentPlan.quota_used)} /> /{" "}
                <DecimalSplit text={formatPoints(currentPlan.quota_limit)} />
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
              剩余 <DecimalSplit text={formatPoints(currentPlan.quota_limit - currentPlan.quota_used)} />{" "}
              积分
              {currentPlan.period_start && currentPlan.period_end && (
                <>
                  <span> · 周期 </span>
                  {formatDate(currentPlan.period_start)} ~ {formatDate(currentPlan.period_end)}
                </>
              )}
            </p>
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
            items={recent()}
            rowKey={(row: BalanceTransaction) => row.id}
            columns={[
              {
                header: "来源",
                cell: row => (
                  <Badge variant={txSourceMeta(row.source).variant}>
                    {txSourceMeta(row.source).label}
                  </Badge>
                ),
              },
              { header: "说明", cell: row => row.detail ?? row.model ?? "—" },
              { header: "变动", align: "right", cell: row => <Delta value={row.delta} /> },
              {
                header: "结余",
                align: "right",
                cell: row => <DecimalSplit text={formatPoints(row.balance_after)} />,
              },
              {
                header: "时间",
                cell: row => (
                  <span title={formatDateTime(row.created_at)}>
                    {formatRelativeTime(row.created_at)}
                  </span>
                ),
              },
            ]}
            cardTitle={row => row.model ?? txSourceMeta(row.source).label}
            cardSubtitle={row => (
              <>
                {row.total_tokens ? `${formatNumber(row.total_tokens)} tok · ` : ""}
                {formatRelativeTime(row.created_at)}
              </>
            )}
            cardRight={row => <Delta value={row.delta} />}
            empty="暂无流水"
            emptyDescription="调用模型之后，这里会按时间列出每一笔扣款"
          />
        </section>

        <p class="text-xs text-muted-foreground">
          账户 {user()?.name ?? "—"}
          {user()?.email ? ` · ${user()!.email}` : ""}
          <span> · 积分口径 1 元 = 10000 积分</span>
        </p>
      </div>
    </>
  );
}
