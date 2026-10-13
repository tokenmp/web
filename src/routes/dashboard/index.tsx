import { Title } from "@solidjs/meta";
import { For, type JSX, Show } from "solid-js";

import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { ErrorState } from "~/components/ui/error-state";
import { billingStatusMeta } from "~/lib/panel-labels";
import { createClientResource } from "~/lib/resource";
import {
  getAdminBillingRecords,
  getDashboardSummary,
  getDashboardUsage,
  type BillingRecord,
  type DashboardSummary,
} from "~/lib/usage";
import { cn, formatCurrency, formatDateTime, formatNumber } from "~/lib/utils";

const EMPTY_SUMMARY: DashboardSummary = {
  last_24h: { requests: 0, success: 0, success_rate: 0, cost: 0, revenue: 0 },
  low_balance_users: 0,
};

/**
 * 控制台概览。
 *
 * 数据来自 /api/admin/dashboard/summary 与 /api/admin/dashboard/usage，
 * 最近流水取 /api/admin/billing_records 的前 5 条。
 *
 * 渠道用量占比那张图没有数据源（渠道相关的 remote 端点本机没有实现），
 * 版式留着但换成按天的收入分布 —— 同样是「一个维度 + 占比条」，不再用假数据凑。
 */
export default function DashboardOverview() {
  const summary = createClientResource(getDashboardSummary, EMPTY_SUMMARY);
  const usage = createClientResource(() => getDashboardUsage(14), {
    items: [] as { day: string; requests: number; revenue: number }[],
    total: 0,
  });
  const recent = createClientResource(() => getAdminBillingRecords({ page: 1, size: 5 }), {
    items: [] as BillingRecord[],
    total: 0,
  });

  const stats = () => {
    const data = summary.data();
    const last = data.last_24h;
    // 加载中不给 0：0 和「真的是 0」分不开，而这一条正好是「有没有出事」的第一眼
    const pending = summary.loading();
    return [
      {
        label: "近 24 小时请求",
        value: pending ? "—" : formatNumber(last.requests),
        hint: pending ? "正在加载…" : `成功 ${formatNumber(last.success)} 次`,
      },
      {
        label: "成功率",
        value: pending ? "—" : `${last.success_rate}%`,
        hint: pending ? "正在加载…" : `${formatNumber(last.success)} / ${formatNumber(last.requests)}`,
      },
      {
        label: "近 24 小时收入",
        value: pending ? "—" : formatCurrency(last.revenue),
        hint: pending ? "正在加载…" : `成本 ${formatCurrency(last.cost)}`,
      },
      {
        label: "余额不足用户",
        value: pending ? "—" : formatNumber(data.low_balance_users),
        hint: pending ? "正在加载…" : "余额 + 授信 ≤ 0",
      },
    ];
  };

  /** 近 7 天的收入分布：条宽按窗口内最大值归一，给右手边那张卡用 */
  const revenueRows = () => {
    const items = usage.data().items.slice(-7);
    const max = Math.max(1, ...items.map(item => item.revenue));
    return items.map(item => ({
      day: item.day,
      revenue: item.revenue,
      share: Math.round((item.revenue / max) * 100),
    }));
  };

  const error = () => summary.error() ?? usage.error() ?? recent.error();

  return (
    <>
      <Title>概览 | tokenmp web</Title>

      <div class="space-y-5">
        <Show when={error()}>
          <ErrorState
            class="rounded-lg border border-destructive/30"
            message={error()!}
            onRetry={() => {
              void summary.reload();
              void usage.reload();
              void recent.reload();
            }}
          />
        </Show>

        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <For each={stats()}>
            {item => (
              <Card class="p-4">
                <p class="text-sm text-muted-foreground">{item.label}</p>
                <p class="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{item.value}</p>
                <p class="mt-1 text-xs text-muted-foreground">{item.hint}</p>
              </Card>
            )}
          </For>
        </div>

        <div class="grid gap-4 lg:grid-cols-7">
          <Card class="lg:col-span-4">
            <div class="flex items-center justify-between p-4 pb-3">
              <div>
                <h2 class="font-semibold tracking-tight">请求趋势</h2>
                <p class="text-sm text-muted-foreground">近 14 天调用次数</p>
              </div>
              <Badge variant="secondary">14 天</Badge>
            </div>
            <div class="px-4 pb-4">
              <TrendChart data={usage.data().items.map(item => item.requests)} />
            </div>
          </Card>

          <Card class="lg:col-span-3">
            <div class="p-4 pb-3">
              <h2 class="font-semibold tracking-tight">近 7 天收入</h2>
              <p class="text-sm text-muted-foreground">按天统计，条宽按窗口内最高一天归一</p>
            </div>
            <div class="space-y-3 px-4 pb-4">
              <Show
                when={revenueRows().length > 0}
                fallback={
                  <p class="text-sm text-muted-foreground">
                    {usage.loading() ? "正在加载…" : usage.error() ? "用量没取到" : "暂无计费数据"}
                  </p>
                }
              >
                <For each={revenueRows()}>
                  {row => (
                    <div class="space-y-1.5">
                      <div class="flex items-center justify-between text-sm">
                        <span class="tabular-nums">{row.day.slice(5)}</span>
                        <span class="tabular-nums text-muted-foreground">
                          {formatCurrency(row.revenue)}
                        </span>
                      </div>
                      <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div class="h-full rounded-full bg-primary" style={{ width: `${row.share}%` }} />
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Card>
        </div>

        <Card>
          <div class="flex items-center justify-between p-4 pb-3">
            <div>
              <h2 class="font-semibold tracking-tight">最近计费流水</h2>
              <p class="text-sm text-muted-foreground">最新的 5 条</p>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[720px] text-sm">
              <thead>
                <tr class="border-y bg-muted/60 text-muted-foreground">
                  <Th>请求 ID</Th>
                  <Th>用户</Th>
                  <Th>模型</Th>
                  <Th class="text-right">收入</Th>
                  <Th>状态</Th>
                  <Th>时间</Th>
                </tr>
              </thead>
              <tbody>
                <Show
                  when={recent.data().items.length > 0}
                  fallback={
                    <tr class="border-b last:border-0">
                      <Td class="py-10 text-center text-muted-foreground">
                        {recent.loading()
                          ? "正在加载…"
                          : recent.error()
                            ? "账单没取到"
                            : "暂无计费流水"}
                      </Td>
                    </tr>
                  }
                >
                  <For each={recent.data().items}>
                    {row => (
                      <tr class="border-b last:border-0">
                        <Td class="font-mono text-xs">{row.request_id}</Td>
                        <Td class="tabular-nums text-muted-foreground">{row.user_id ?? "—"}</Td>
                        <Td>{row.model ?? "—"}</Td>
                        <Td class="text-right tabular-nums">{formatCurrency(row.revenue_amount)}</Td>
                        <Td>
                          <Badge variant={billingStatusMeta(row.status).variant}>
                            {billingStatusMeta(row.status).label}
                          </Badge>
                        </Td>
                        <Td class="tabular-nums text-muted-foreground">
                          {formatDateTime(row.created_at)}
                        </Td>
                      </tr>
                    )}
                  </For>
                </Show>
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

function Th(props: { children: JSX.Element; class?: string }) {
  return (
    <th class={cn("px-4 py-2.5 text-left font-medium", props.class)}>{props.children}</th>
  );
}

function Td(props: { children: JSX.Element; class?: string }) {
  return <td class={cn("px-4 py-3", props.class)}>{props.children}</td>;
}

/** 近 14 天趋势：面积图直接用 SVG 画，不引图表库 */
function TrendChart(props: { data: number[] }) {
  const width = 640;
  const height = 160;
  const pad = 6;
  // 全 0 的一天或只有一天的数据时，分母给个地板值，避免算出 NaN
  const max = () => Math.max(1, ...props.data) * 1.1;
  const span = () => Math.max(1, props.data.length - 1);

  const points = () =>
    props.data.map((value, index) => {
      const x = pad + (index * (width - pad * 2)) / span();
      const y = height - pad - (value / max()) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

  const areaPoints = () => `${pad},${height - pad} ${points().join(" ")} ${width - pad},${height - pad}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      class="h-40 w-full text-primary"
      preserveAspectRatio="none"
      role="img"
      aria-label="近 14 天请求趋势"
    >
      <defs>
        <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.28" />
          <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
        </linearGradient>
      </defs>
      <For each={[0.25, 0.5, 0.75]}>
        {ratio => (
          <line
            x1={pad}
            x2={width - pad}
            y1={height * ratio}
            y2={height * ratio}
            stroke="currentColor"
            stroke-opacity="0.08"
            stroke-width="1"
          />
        )}
      </For>
      <polygon points={areaPoints()} fill="url(#trend-fill)" />
      <polyline
        points={points().join(" ")}
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
  );
}
