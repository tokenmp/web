import { Title } from "@solidjs/meta";
import Download from "lucide-solid/icons/download";
import { createEffect, createSignal, For, on, Show } from "solid-js";

import { StatRow } from "~/components/layout/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ErrorState } from "~/components/ui/error-state";
import { PagerIfNeeded } from "~/components/ui/pager";
import { Segmented } from "~/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Toolbar, ToolbarDivider } from "~/components/ui/toolbar";
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

  // 加载中不给 0：0 和「真的是 0 元」分不开，取数失败时更是直接误导
  const stats = () => [
    { label: "本页收入", value: list.loading() ? "—" : formatCurrency(pageTotals().revenue) },
    { label: "本页成本", value: list.loading() ? "—" : formatCurrency(pageTotals().cost) },
    { label: "本页毛利", value: list.loading() ? "—" : formatCurrency(pageTotals().margin) },
    {
      label: "筛选结果",
      value: list.loading() ? "—" : formatNumber(list.data().total),
      hint: "符合条件的总条数",
    },
  ];

  return (
    <>
      <Title>计费 | tokenmp web</Title>


      <StatRow items={stats()} />

      <Card class="overflow-hidden">
        <Toolbar>
          <Segmented
            options={timeRanges}
            value={range()}
            onChange={value => {
              setRange(value);
              setPage(1);
            }}
            ariaLabel="时间范围"
          />

          {/* 两组筛选之间要断开：之前两组只隔 8px，七个选项连成一片，看着像一个控件 */}
          <ToolbarDivider />

          <Segmented
            options={statusTabs}
            value={status()}
            onChange={value => {
              setStatus(value);
              setPage(1);
            }}
            ariaLabel="流水状态"
          />

          {/* 手机上一行塞不下两组分段，导出按钮会单独落到下一行。用 ml-auto 而不是
              ToolbarSpacer：后者只是一个 0 宽的占位块，它先被放到上一行之后，
              就没有空的宽度留给落到下一行的按钮了。 */}
          <Button variant="outline" class="ml-auto">
            <Download class="size-4" aria-hidden="true" />
            导出 CSV
          </Button>
        </Toolbar>

        <Show when={list.error()}>
          <ErrorState
            variant="inline"
            class="border-b px-4"
            message={list.error()!}
            onRetry={() => void list.reload()}
          />
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
                  {list.loading() ? "正在加载…" : "这个时间范围下没有符合条件的账单"}
                </TableCell>
              </TableRow>
            </Show>
          </TableBody>
        </Table>

        <PagerIfNeeded
          page={page()}
          size={SIZE}
          total={list.data().total}
          onPageChange={setPage}
        />
      </Card>
    </>
  );
}
