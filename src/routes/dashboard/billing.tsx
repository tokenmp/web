import { Title } from "@solidjs/meta";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Download from "lucide-solid/icons/download";
import { createMemo, createSignal, For, Show } from "solid-js";

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
import { formatCurrency, formatNumber } from "~/lib/utils";

// 设计样板用的示例数据，接后端时替换
type OrderStatus = "已支付" | "待支付" | "已退款";

type Order = {
  id: string;
  user: string;
  plan: string;
  amount: number;
  method: string;
  status: OrderStatus;
  at: string;
  daysAgo: number;
};

const orders: Order[] = [
  {
    id: "SO-20261010-0187",
    user: "lin.zy@example.com",
    plan: "专业版月付",
    amount: 199,
    method: "支付宝",
    status: "已支付",
    at: "10-10 14:52",
    daysAgo: 0,
  },
  {
    id: "SO-20261010-0186",
    user: "wang.qi@example.com",
    plan: "按量充值 $100",
    amount: 100,
    method: "微信支付",
    status: "已支付",
    at: "10-10 14:31",
    daysAgo: 0,
  },
  {
    id: "SO-20261010-0185",
    user: "chen.mo@example.com",
    plan: "标准版月付",
    amount: 69,
    method: "支付宝",
    status: "待支付",
    at: "10-10 13:58",
    daysAgo: 0,
  },
  {
    id: "SO-20261009-0184",
    user: "zhao.lin@example.com",
    plan: "专业版年付",
    amount: 1990,
    method: "对公转账",
    status: "已支付",
    at: "10-09 16:12",
    daysAgo: 1,
  },
  {
    id: "SO-20261008-0183",
    user: "sun.yu@example.com",
    plan: "标准版月付",
    amount: 69,
    method: "微信支付",
    status: "已退款",
    at: "10-08 12:40",
    daysAgo: 2,
  },
  {
    id: "SO-20261007-0182",
    user: "zhou.han@example.com",
    plan: "企业版年付",
    amount: 19900,
    method: "对公转账",
    status: "已支付",
    at: "10-07 10:05",
    daysAgo: 3,
  },
  {
    id: "SO-20261005-0181",
    user: "wu.xin@example.com",
    plan: "按量充值 $500",
    amount: 500,
    method: "信用卡",
    status: "待支付",
    at: "10-05 21:47",
    daysAgo: 5,
  },
  {
    id: "SO-20260928-0180",
    user: "zheng.pei@example.com",
    plan: "标准版年付",
    amount: 690,
    method: "PayPal",
    status: "已退款",
    at: "09-28 09:33",
    daysAgo: 12,
  },
];

const stats = [
  { label: "本月收入", value: formatCurrency(486320.55), hint: "较上月 +12.4%" },
  { label: "待支付", value: formatCurrency(18240.0), hint: "共 37 笔未结清" },
  { label: "已退款", value: formatCurrency(3120.4), hint: "本月 9 笔" },
  { label: "客单价", value: formatCurrency(378.62), hint: "按已支付订单计算" },
];

const timeRanges = ["今天", "本周", "本月"] as const;
const statusTabs = ["全部", "已支付", "待支付", "已退款"] as const;

function badgeVariant(status: OrderStatus) {
  if (status === "已支付") return "success" as const;
  if (status === "待支付") return "warning" as const;
  return "destructive" as const;
}

export default function DashboardBilling() {
  const [range, setRange] = createSignal<(typeof timeRanges)[number]>("本月");
  const [status, setStatus] = createSignal<(typeof statusTabs)[number]>("全部");

  const filtered = createMemo(() => {
    const maxDays = range() === "今天" ? 0 : range() === "本周" ? 6 : 29;
    return orders.filter(
      order =>
        order.daysAgo <= maxDays && (status() === "全部" || order.status === status()),
    );
  });

  return (
    <>
      <Title>计费 | TokenMP 销售控制台</Title>

      <PageHeader description="订单流水、收款状态与退款记录" />

      <StatRow items={stats} />

      <Card class="overflow-hidden">
        <div class="flex flex-wrap items-center gap-2 border-b p-4">
          <Segmented options={timeRanges} value={range()} onChange={setRange} ariaLabel="时间范围" />

          <Segmented options={statusTabs} value={status()} onChange={setStatus} ariaLabel="订单状态" />

          <Button variant="outline" class="ml-auto">
            <Download class="size-4" />
            导出 CSV
          </Button>
        </div>

        <Table class="border-b" tableClass="min-w-[880px]">
          <TableHeader>
            <TableRow>
              <TableHead>订单号</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>套餐</TableHead>
              <TableHead class="text-right">金额</TableHead>
              <TableHead>支付方式</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>下单时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={filtered()}>
              {order => (
                <TableRow>
                  <TableCell class="font-mono text-xs">{order.id}</TableCell>
                  <TableCell class="font-medium">{order.user}</TableCell>
                  <TableCell class="text-muted-foreground">{order.plan}</TableCell>
                  <TableCell class="text-right tabular-nums">
                    {formatCurrency(order.amount)}
                  </TableCell>
                  <TableCell class="text-muted-foreground">{order.method}</TableCell>
                  <TableCell>
                    <Badge variant={badgeVariant(order.status)}>{order.status}</Badge>
                  </TableCell>
                  <TableCell class="tabular-nums text-muted-foreground">{order.at}</TableCell>
                </TableRow>
              )}
            </For>
            <Show when={filtered().length === 0}>
              <TableRow>
                <TableCell class="py-10 text-center text-muted-foreground" colSpan={7}>
                  这个时间范围下没有符合条件的订单
                </TableCell>
              </TableRow>
            </Show>
          </TableBody>
        </Table>

        <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm text-muted-foreground">
          <p aria-live="polite">
            共 {formatNumber(1284)} 条，当前显示第 {formatNumber(1)} 到{" "}
            {formatNumber(filtered().length)} 条
          </p>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="icon" disabled aria-label="上一页">
              <ChevronLeft class="size-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="下一页">
              <ChevronRight class="size-4" />
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
