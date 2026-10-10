import { Title } from "@solidjs/meta";
import { ArrowDownRight, ArrowUpRight } from "lucide-solid";
import { For, type JSX } from "solid-js";

import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { cn, formatCurrency, formatNumber } from "~/lib/utils";

// 设计样板用的示例数据，接后端时替换
const stats = [
  { label: "账户余额", value: formatCurrency(12480.52), delta: 4.2, hint: "较昨日" },
  { label: "今日消耗", value: formatCurrency(326.18), delta: 12.4, hint: "较昨日" },
  { label: "活跃用户", value: formatNumber(1284), delta: 3.2, hint: "近 24 小时" },
  { label: "今日请求", value: formatNumber(482913), delta: -1.8, hint: "较昨日" },
];

const trend = [
  18200, 21400, 19800, 24600, 23100, 27400, 25900, 31200, 28900, 33400, 30100, 35800, 34200,
  38600,
];

const channels = [
  { name: "OpenAI", share: 46, amount: 150.24 },
  { name: "Anthropic", share: 27, amount: 88.62 },
  { name: "Gemini", share: 15, amount: 49.31 },
  { name: "DeepSeek", share: 8, amount: 26.47 },
  { name: "其他", share: 4, amount: 11.54 },
];

const recent = [
  { id: "SO-20261010-0187", user: "lin@example.com", plan: "专业版月付", amount: 199.0, status: "已支付", at: "10-10 14:52" },
  { id: "SO-20261010-0186", user: "wang@example.com", plan: "标准版月付", amount: 69.0, status: "已支付", at: "10-10 14:31" },
  { id: "SO-20261010-0185", user: "chen@example.com", plan: "按量充值 $100", amount: 100.0, status: "待支付", at: "10-10 13:58" },
  { id: "SO-20261010-0184", user: "zhao@example.com", plan: "专业版年付", amount: 1990.0, status: "已支付", at: "10-10 13:12" },
  { id: "SO-20261010-0183", user: "sun@example.com", plan: "标准版月付", amount: 69.0, status: "已退款", at: "10-10 12:40" },
];

export default function DashboardOverview() {
  return (
    <>
      <Title>概览 | TokenMP 销售控制台</Title>

      <div class="space-y-5">
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <For each={stats}>
            {item => (
              <Card class="p-5">
                <p class="text-sm text-muted-foreground">{item.label}</p>
                <p class="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{item.value}</p>
                <p class="mt-1 flex items-center gap-1 text-xs">
                  <span
                    class={cn(
                      "inline-flex items-center gap-0.5 font-medium",
                      item.delta >= 0 ? "text-success" : "text-destructive",
                    )}
                  >
                    {item.delta >= 0 ? (
                      <ArrowUpRight class="size-3.5" />
                    ) : (
                      <ArrowDownRight class="size-3.5" />
                    )}
                    {Math.abs(item.delta)}%
                  </span>
                  <span class="text-muted-foreground">{item.hint}</span>
                </p>
              </Card>
            )}
          </For>
        </div>

        <div class="grid gap-4 lg:grid-cols-7">
          <Card class="lg:col-span-4">
            <div class="flex items-center justify-between p-5 pb-3">
              <div>
                <h2 class="font-semibold tracking-tight">消耗趋势</h2>
                <p class="text-sm text-muted-foreground">近 14 天 Token 用量</p>
              </div>
              <Badge variant="secondary">14 天</Badge>
            </div>
            <div class="px-5 pb-5">
              <TrendChart data={trend} />
            </div>
          </Card>

          <Card class="lg:col-span-3">
            <div class="p-5 pb-3">
              <h2 class="font-semibold tracking-tight">渠道用量占比</h2>
              <p class="text-sm text-muted-foreground">按今日消耗金额统计</p>
            </div>
            <div class="space-y-3 px-5 pb-5">
              <For each={channels}>
                {channel => (
                  <div class="space-y-1.5">
                    <div class="flex items-center justify-between text-sm">
                      <span>{channel.name}</span>
                      <span class="tabular-nums text-muted-foreground">
                        {formatCurrency(channel.amount)} · {channel.share}%
                      </span>
                    </div>
                    <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        class="h-full rounded-full bg-primary"
                        style={{ width: `${channel.share}%` }}
                      />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Card>
        </div>

        <Card>
          <div class="flex items-center justify-between p-5 pb-3">
            <div>
              <h2 class="font-semibold tracking-tight">最近订单</h2>
              <p class="text-sm text-muted-foreground">最新的 5 条销售记录</p>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[720px] text-sm">
              <thead>
                <tr class="border-y bg-muted/50 text-muted-foreground">
                  <Th>订单号</Th>
                  <Th>用户</Th>
                  <Th>套餐</Th>
                  <Th class="text-right">金额</Th>
                  <Th>状态</Th>
                  <Th>时间</Th>
                </tr>
              </thead>
              <tbody>
                <For each={recent}>
                  {row => (
                    <tr class="border-b last:border-0">
                      <Td class="font-mono text-xs">{row.id}</Td>
                      <Td>{row.user}</Td>
                      <Td class="text-muted-foreground">{row.plan}</Td>
                      <Td class="text-right tabular-nums">{formatCurrency(row.amount)}</Td>
                      <Td>
                        <Badge
                          variant={
                            row.status === "已支付"
                              ? "success"
                              : row.status === "待支付"
                                ? "warning"
                                : "destructive"
                          }
                        >
                          {row.status}
                        </Badge>
                      </Td>
                      <Td class="tabular-nums text-muted-foreground">{row.at}</Td>
                    </tr>
                  )}
                </For>
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
    <th class={cn("px-5 py-2.5 text-left font-medium", props.class)}>{props.children}</th>
  );
}

function Td(props: { children: JSX.Element; class?: string }) {
  return <td class={cn("px-5 py-3", props.class)}>{props.children}</td>;
}

/** 14 天趋势：面积图直接用 SVG 画，不引图表库 */
function TrendChart(props: { data: number[] }) {
  const width = 640;
  const height = 160;
  const pad = 6;
  const max = () => Math.max(...props.data) * 1.1;

  const points = () =>
    props.data.map((value, index) => {
      const x = pad + (index * (width - pad * 2)) / (props.data.length - 1);
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
      aria-label="近 14 天用量趋势"
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
