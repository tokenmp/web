import { Title } from "@solidjs/meta";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import { For, type JSX } from "solid-js";

import { PageHeader, StatRow } from "~/components/layout/page-header";
import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { Dialog, DialogClose } from "~/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { cn, formatCurrency, formatNumber } from "~/lib/utils";

// 设计样板用的示例数据，接后端时替换
type ChannelStatus = "正常" | "限流" | "不可用";

type Channel = {
  name: string;
  vendor: string;
  status: ChannelStatus;
  balance: number;
  successRate: number;
  latency: number;
  checkedAt: string;
};

const demoChannels: Channel[] = [
  {
    name: "OpenAI 直连 · 新加坡",
    vendor: "OpenAI",
    status: "正常",
    balance: 2840.6,
    successRate: 99.4,
    latency: 412,
    checkedAt: "刚刚",
  },
  {
    name: "Anthropic 官方",
    vendor: "Anthropic",
    status: "正常",
    balance: 1265.3,
    successRate: 99.1,
    latency: 638,
    checkedAt: "1 分钟前",
  },
  {
    name: "Gemini 企业版",
    vendor: "Gemini",
    status: "限流",
    balance: 612.45,
    successRate: 96.8,
    latency: 903,
    checkedAt: "2 分钟前",
  },
  {
    name: "DeepSeek 官方",
    vendor: "DeepSeek",
    status: "正常",
    balance: 318.2,
    successRate: 98.7,
    latency: 276,
    checkedAt: "3 分钟前",
  },
  {
    name: "火山方舟 · 豆包",
    vendor: "豆包",
    status: "限流",
    balance: 148.75,
    successRate: 94.5,
    latency: 452,
    checkedAt: "5 分钟前",
  },
  {
    name: "阿里云百炼 · 通义",
    vendor: "通义千问",
    status: "正常",
    balance: 204.9,
    successRate: 98.2,
    latency: 331,
    checkedAt: "6 分钟前",
  },
  {
    name: "OpenRouter 聚合线路",
    vendor: "OpenAI",
    status: "正常",
    balance: 96.3,
    successRate: 97.3,
    latency: 725,
    checkedAt: "8 分钟前",
  },
  {
    name: "智谱 GLM 开放平台",
    vendor: "GLM",
    status: "不可用",
    balance: 12.4,
    successRate: 82.6,
    latency: 1840,
    checkedAt: "12 分钟前",
  },
];

function statusVariant(status: ChannelStatus) {
  if (status === "正常") return "success" as const;
  if (status === "限流") return "warning" as const;
  return "destructive" as const;
}

export default function DashboardChannels() {
  const stats = [
    { label: "渠道总数", value: formatNumber(demoChannels.length), hint: "含停用线路" },
    {
      label: "可用渠道",
      value: formatNumber(demoChannels.filter(item => item.status === "正常").length),
      hint: "近 5 分钟探测通过",
    },
    { label: "今日调用", value: formatNumber(486213), hint: "较昨日 +5.8%" },
    { label: "平均延迟", value: "412 ms", hint: "全渠道加权" },
  ];

  return (
    <>
      <Title>渠道 | TokenMP 销售控制台</Title>

      <PageHeader description="上游模型供应商的接入状态、余额与稳定性" />

      <StatRow items={stats} />

      <Card>
        <div class="p-5 pb-3">
          <h2 class="font-semibold tracking-tight">渠道列表</h2>
          <p class="text-sm text-muted-foreground">余额低于 20 美元或成功率低于 95% 的渠道需要关注</p>
        </div>

        <Table tableClass="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead>渠道名称</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>状态</TableHead>
              <TableHead class="text-right">余额</TableHead>
              <TableHead>成功率</TableHead>
              <TableHead class="text-right">平均延迟</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={demoChannels}>
              {channel => (
                <TableRow>
                  <TableCell class="font-medium">{channel.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{channel.vendor}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(channel.status)}>{channel.status}</Badge>
                  </TableCell>
                  <TableCell class="text-right tabular-nums">{formatCurrency(channel.balance)}</TableCell>
                  <TableCell>
                    <div class="flex items-center gap-2">
                      <div
                        class="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted sm:w-20"
                        aria-hidden="true"
                      >
                        <div
                          class="h-full rounded-full bg-primary"
                          style={{ width: `${channel.successRate}%` }}
                        />
                      </div>
                      <span class="text-sm tabular-nums text-muted-foreground">
                        {channel.successRate}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell class={cn("text-right tabular-nums", latencyClass(channel))}>
                    {formatNumber(channel.latency)} ms
                  </TableCell>
                  <TableCell class="text-right">
                    <Dialog
                      trigger="测试连接"
                      title={`测试连接 · ${channel.name}`}
                      description="探针向该渠道发一次最小请求，结果如下"
                      footer={
                        <>
                          <DialogClose>关闭</DialogClose>
                          <DialogClose variant="default">
                            <RefreshCw class="size-4" />
                            重新测试
                          </DialogClose>
                        </>
                      }
                    >
                      <dl class="space-y-3">
                        <Field
                          label="延迟"
                          value={`${formatNumber(channel.latency)} ms`}
                        />
                        <Field
                          label="状态"
                          value={
                            <Badge variant={statusVariant(channel.status)}>
                              {channel.status}
                            </Badge>
                          }
                        />
                        <Field label="成功率" value={`${channel.successRate}%`} />
                        <Field label="最近探测" value={channel.checkedAt} />
                      </dl>
                    </Dialog>
                  </TableCell>
                </TableRow>
              )}
            </For>
          </TableBody>
        </Table>

        <div class="border-t px-5 py-3 text-sm text-muted-foreground">
          共 {formatNumber(demoChannels.length)} 个渠道，
          {formatNumber(demoChannels.filter(item => item.status !== "正常").length)} 个需要关注
        </div>
      </Card>
    </>
  );
}

/** 延迟按阈值上色：不可用走危险色，限流或超过 900ms 走提醒色 */
function latencyClass(channel: Channel) {
  if (channel.status === "不可用") return "text-destructive-text";
  if (channel.status === "限流" || channel.latency >= 900) return "text-warning-text";
  return "text-success-text";
}

function Field(props: { label: string; value: JSX.Element }) {
  return (
    <div class="flex items-center justify-between gap-4">
      <dt class="text-muted-foreground">{props.label}</dt>
      <dd class="font-medium">{props.value}</dd>
    </div>
  );
}
