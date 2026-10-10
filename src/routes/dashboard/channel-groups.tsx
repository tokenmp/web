import { Title } from "@solidjs/meta";
import CircleCheck from "lucide-solid/icons/circle-check";
import { createSignal, For, Show } from "solid-js";

import { PageHeader, StatRow } from "~/components/layout/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Sheet, SheetClose } from "~/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { cn, formatNumber } from "~/lib/utils";

// 设计样板用的示例数据，接后端时替换
type GroupStatus = "启用" | "已停用" | "降级";
type Strategy = "轮询" | "加权随机" | "故障转移";

type ChannelGroup = {
  name: string;
  channels: number;
  strategy: Strategy;
  weight: number;
  priority: number;
  status: GroupStatus;
};

const demoGroups: ChannelGroup[] = [
  { name: "主力 OpenAI 分组", channels: 4, strategy: "加权随机", weight: 60, priority: 1, status: "启用" },
  { name: "Claude 长文分组", channels: 3, strategy: "故障转移", weight: 30, priority: 2, status: "启用" },
  { name: "Gemini 备用分组", channels: 3, strategy: "轮询", weight: 20, priority: 3, status: "启用" },
  { name: "DeepSeek 成本优先", channels: 2, strategy: "加权随机", weight: 15, priority: 4, status: "启用" },
  { name: "国产模型聚合", channels: 6, strategy: "轮询", weight: 10, priority: 5, status: "启用" },
  { name: "海外直连兜底", channels: 2, strategy: "故障转移", weight: 5, priority: 6, status: "降级" },
  { name: "内部灰度测试", channels: 1, strategy: "轮询", weight: 0, priority: 9, status: "已停用" },
  { name: "合作方专用-启明科技", channels: 3, strategy: "加权随机", weight: 25, priority: 2, status: "启用" },
];

const strategies: { name: Strategy; hint: string }[] = [
  { name: "轮询", hint: "按顺序把请求轮流分给组内渠道，适合各渠道价格与配额接近的情况。" },
  { name: "加权随机", hint: "按权重随机挑选，权重高的渠道分到更多请求，适合上游速率不一致时。" },
  { name: "故障转移", hint: "优先用排在最前的渠道，遇到报错或超时再自动切到下一个。" },
];

const channelOptions = [
  "OpenAI 直连主账号",
  "OpenAI 代理池",
  "Azure OpenAI 企业版",
  "Anthropic 官方",
  "Anthropic 中转",
  "Google Gemini 直连",
  "Gemini 代理商",
  "DeepSeek 官方",
  "通义千问企业版",
];

const stats = [
  { label: "分组总数", value: formatNumber(demoGroups.length), hint: "按优先级依次路由" },
  {
    label: "启用中",
    value: formatNumber(demoGroups.filter(group => group.status === "启用").length),
    hint: "正在承接线上流量",
  },
  {
    label: "已停用",
    value: formatNumber(demoGroups.filter(group => group.status === "已停用").length),
    hint: "不会收到新请求",
  },
  {
    label: "覆盖渠道",
    value: formatNumber(demoGroups.reduce((sum, group) => sum + group.channels, 0)),
    hint: "含重复计入的渠道",
  },
];

function statusVariant(status: GroupStatus) {
  if (status === "启用") return "success" as const;
  if (status === "降级") return "warning" as const;
  return "secondary" as const;
}

export default function DashboardChannelGroups() {
  const [groupName, setGroupName] = createSignal("");
  const [strategy, setStrategy] = createSignal<Strategy>("加权随机");
  const [selected, setSelected] = createSignal<string[]>(["OpenAI 直连主账号", "OpenAI 代理池"]);

  function toggleChannel(name: string) {
    setSelected(list =>
      list.includes(name) ? list.filter(item => item !== name) : [...list, name],
    );
  }

  return (
    <>
      <Title>渠道分组 | TokenMP 销售控制台</Title>

      <PageHeader description="分组决定请求先落到哪个渠道">
        <Sheet
          side="right"
          trigger="新建分组"
          title="新建渠道分组"
          description="填好分组名并勾选渠道，保存后立刻生效"
          footer={<SheetClose variant="default">保存分组</SheetClose>}
        >
          <div class="space-y-5">
            <div class="space-y-2">
              <Label for="group-name">分组名称</Label>
              <Input
                id="group-name"
                placeholder="例如：主力 OpenAI 分组"
                value={groupName()}
                onInput={event => setGroupName(event.currentTarget.value)}
              />
            </div>

            <div class="space-y-2">
              <p class="text-sm font-medium">路由策略</p>
              <div class="space-y-2" role="radiogroup" aria-label="路由策略">
                <For each={strategies}>
                  {item => {
                    const active = () => strategy() === item.name;
                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={active()}
                        onClick={() => setStrategy(item.name)}
                        class={cn(
                          "w-full rounded-lg p-3 text-left transition-colors",
                          active() ? "bg-primary/10 ring-1 ring-primary" : "bg-muted/50 hover:bg-accent",
                        )}
                      >
                        <span class="flex items-center justify-between text-sm font-medium">
                          {item.name}
                          <Show when={active()}>
                            <CircleCheck class="size-4 text-primary" />
                          </Show>
                        </span>
                        <span class="mt-1 block text-xs text-muted-foreground">{item.hint}</span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>

            <div class="space-y-2">
              <p class="text-sm font-medium">包含渠道</p>
              <p class="text-xs text-muted-foreground">
                已选 {selected().length} 个，点击按钮切换选中状态
              </p>
              <div class="flex flex-wrap gap-2" role="group" aria-label="包含渠道">
                <For each={channelOptions}>
                  {channel => {
                    const checked = () => selected().includes(channel);
                    return (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={checked()}
                        onClick={() => toggleChannel(channel)}
                        class={cn(
                          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                          checked()
                            ? "border-primary bg-primary/10 text-foreground"
                            : "text-muted-foreground hover:bg-accent",
                        )}
                      >
                        <span
                          class={cn(
                            "grid size-3.5 shrink-0 place-items-center rounded-[4px] border",
                            checked() && "border-primary bg-primary text-primary-foreground",
                          )}
                        >
                          <Show when={checked()}>
                            <CircleCheck class="size-2.5" />
                          </Show>
                        </span>
                        {channel}
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
          </div>
        </Sheet>
      </PageHeader>

      <StatRow items={stats} />

      <Card class="overflow-hidden">
        <Table tableClass="min-w-[880px]">
          <TableHeader>
            <TableRow>
              <TableHead>分组名称</TableHead>
              <TableHead>包含渠道数</TableHead>
              <TableHead>路由策略</TableHead>
              <TableHead class="text-right">权重</TableHead>
              <TableHead class="text-right">优先级</TableHead>
              <TableHead>状态</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={demoGroups}>
              {group => (
                <TableRow>
                  <TableCell class="font-medium">{group.name}</TableCell>
                  <TableCell class="tabular-nums text-muted-foreground">
                    {formatNumber(group.channels)} 个
                  </TableCell>
                  <TableCell>{group.strategy}</TableCell>
                  <TableCell class="text-right tabular-nums">{formatNumber(group.weight)}</TableCell>
                  <TableCell class="text-right tabular-nums">{group.priority}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(group.status)}>{group.status}</Badge>
                  </TableCell>
                  <TableCell class="text-right">
                    <Button variant="link" size="sm" aria-label={`编辑分组 ${group.name}`}>
                      编辑
                    </Button>
                  </TableCell>
                </TableRow>
              )}
            </For>
          </TableBody>
        </Table>

        <div class="border-t px-5 py-3 text-sm text-muted-foreground">
          共 {formatNumber(demoGroups.length)} 个分组，请求按优先级从小到大依次匹配
        </div>
      </Card>
    </>
  );
}
