import { Title } from "@solidjs/meta";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Download from "lucide-solid/icons/download";
import { createEffect, createSignal, For, on, Show } from "solid-js";

import { PageHeader, StatRow } from "~/components/layout/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Segmented } from "~/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { billingStatusMeta } from "~/lib/panel-labels";
import { createClientResource } from "~/lib/resource";
import { getAdminBillingRecords, type BillingRecord } from "~/lib/usage";
import { formatCurrency, formatDateTime, formatNumber } from "~/lib/utils";

const SIZE = 20;

const timeRanges = ["今天", "本周", "本月"] as const;
const statusTabs = ["全部", "成功", "失败", "已结算"] as const;

type TimeRange = (typeof timeRanges)[number];
type StatusTab = (typeof statusTabs)[number];

/** 时间范围换算成 start 参数。数据库按 UTC 存，今天取 UTC 零点 */
function rangeStart(range: TimeRange) {
  const now = new Date();
  if (range === "今天") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  }
  const days = range === "本周" ? 7 : 30;
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** 账单状态。表里默认 settled，内核回写成功/失败时是 success / error */
const STATUS_VALUES: Record<StatusTab, string | undefined> = {
  全部: undefined,
  成功: "success",
  失败: "error",
  已结算: "settled",
};

/**
 * 控制台计费。
 *
 * 数据来自 /api/admin/billing_records（转发内核回写的计费流水）。
 * 原来的「订单/收款/退款」是销售订单视角，本机没有对应的表与端点；
 * 这里按计费流水的视角重排了列，筛选与分页都走服务端。
 *
 * 顶部四个数是「本页」口径：分页接口只回一页的 items 与总数 total，
 * 没有全量聚合，所以统一标注本页，不假装是全站数字。
 */
export default function DashboardBilling() {
  const [range, setRange] = createSignal<TimeRange>("本月");
  const [status, setStatus] = createSignal<StatusTab>("全部");
  const [page, setPage] = createSignal(1);

  const list = createClientResource(
    () =>
      getAdminBillingRecords({
        page: page(),
        size: SIZE,
        start: rangeStart(range()),
        status: STATUS_VALUES[status()],
      }),
    { items: [] as BillingRecord[], total: 0 },
  );

  createEffect(
    on(
      () => [range(), status(), page()],
      () => {
        void list.reload();
      },
      { defer: true },
    ),
  );

  const pageTotals = () => {
    const items = list.data().items;
    const revenue = items.reduce((sum, row) => sum + row.revenue_amount, 0);
    const cost = items.reduce((sum, row) => sum + row.cost_amount, 0);
    return { revenue, cost, margin: revenue - cost };
  };

  const stats = () => [
    { label: "本页收入", value: formatCurrency(pageTotals().revenue) },
    { label: "本页成本", value: formatCurrency(pageTotals().cost) },
    { label: "本页毛利", value: formatCurrency(pageTotals().margin) },
    { label: "筛选结果", value: formatNumber(list.data().total), hint: "符合条件的总条数" },
  ];

  const totalPages = () => Math.max(1, Math.ceil(list.data().total / SIZE));

  return (
    <>
      <Title>计费 | TokenMP 销售控制台</Title>

      <PageHeader description="计费流水：成本、收入与结算状态" />

      <StatRow items={stats()} />

      <Card class="overflow-hidden">
        <div class="flex flex-wrap items-center gap-2 border-b p-4">
          <Segmented
            options={timeRanges}
            value={range()}
            onChange={value => {
              setRange(value);
              setPage(1);
            }}
            ariaLabel="时间范围"
          />

          <Segmented
            options={statusTabs}
            value={status()}
            onChange={value => {
              setStatus(value);
              setPage(1);
            }}
            ariaLabel="流水状态"
          />

          <Button variant="outline" class="ml-auto">
            <Download class="size-4" />
            导出 CSV
          </Button>
        </div>

        <Show when={list.error()}>
          <p class="border-b bg-destructive/10 px-4 py-2.5 text-sm text-destructive-text" role="alert">
            {list.error()}
          </p>
        </Show>

        <Table class="border-b" tableClass="min-w-[880px]">
          <TableHeader>
            <TableRow>
              <TableHead>请求 ID</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>模型</TableHead>
              <TableHead>渠道</TableHead>
              <TableHead class="text-right">成本</TableHead>
              <TableHead class="text-right">收入</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={list.data().items}>
              {row => (
                <TableRow>
                  <TableCell class="font-mono text-xs">{row.request_id}</TableCell>
                  <TableCell class="tabular-nums text-muted-foreground">{row.user_id ?? "—"}</TableCell>
                  <TableCell class="font-medium">{row.model ?? "—"}</TableCell>
                  <TableCell class="text-muted-foreground">{row.channel_name ?? "—"}</TableCell>
                  <TableCell class="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(row.cost_amount)}
                  </TableCell>
                  <TableCell class="text-right tabular-nums">
                    {formatCurrency(row.revenue_amount)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={billingStatusMeta(row.status).variant}>
                      {billingStatusMeta(row.status).label}
                    </Badge>
                  </TableCell>
                  <TableCell class="tabular-nums text-muted-foreground">
                    {formatDateTime(row.created_at)}
                  </TableCell>
                </TableRow>
              )}
            </For>
            <Show when={list.data().items.length === 0}>
              <TableRow>
                <TableCell class="py-10 text-center text-muted-foreground" colSpan={8}>
                  这个时间范围下没有符合条件的流水
                </TableCell>
              </TableRow>
            </Show>
          </TableBody>
        </Table>

        <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm text-muted-foreground">
          <p aria-live="polite">
            共 {formatNumber(list.data().total)} 条，当前第 {formatNumber(page())} /{" "}
            {formatNumber(totalPages())} 页
          </p>
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              disabled={page() <= 1}
              aria-label="上一页"
              onClick={() => setPage(current => Math.max(1, current - 1))}
            >
              <ChevronLeft class="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="下一页"
              disabled={page() >= totalPages()}
              onClick={() => setPage(current => Math.min(totalPages(), current + 1))}
            >
              <ChevronRight class="size-4" />
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
