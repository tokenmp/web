import { Title } from "@solidjs/meta";
import Check from "lucide-solid/icons/check";
import X from "lucide-solid/icons/x";
import { createMemo, createSignal, For, Show } from "solid-js";

import { PageHeader, StatRow } from "~/components/layout/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Dialog, DialogClose } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Segmented } from "~/components/ui/segmented";
import { Label } from "~/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { formatNumber } from "~/lib/utils";

// 设计样板用的示例数据，接后端时替换
type ApplicationStatus = "待处理" | "已通过" | "已驳回";

type Application = {
  applicant: string;
  contact: string;
  channel: string;
  purpose: string;
  submittedAt: string;
  status: ApplicationStatus;
  rejectReason?: string;
};

const applications: Application[] = [
  {
    applicant: "林知远",
    contact: "lin.zy@example.com",
    channel: "OpenAI 官方直连",
    purpose: "客服质检平台需要调用 gpt-4o 做会话摘要，预计日请求 2 万次",
    submittedAt: "10-10 14:52",
    status: "待处理",
  },
  {
    applicant: "汪启明",
    contact: "wang.qm@example.com",
    channel: "Anthropic Claude 直连",
    purpose: "法律文书起草助手，主要用 claude-sonnet-4，需要长上下文",
    submittedAt: "10-10 13:18",
    status: "待处理",
  },
  {
    applicant: "陈墨",
    contact: "chen.mo@example.com",
    channel: "Gemini 企业版",
    purpose: "跨境电商商品图文生成，调用 gemini-2.5-flash，需要图片输入",
    submittedAt: "10-10 11:40",
    status: "待处理",
  },
  {
    applicant: "赵琳",
    contact: "zhao.lin@example.com",
    channel: "DeepSeek 官方",
    purpose: "内部知识库检索问答，量不大，先跑一个月试点",
    submittedAt: "10-09 17:26",
    status: "已通过",
  },
  {
    applicant: "孙宇",
    contact: "sun.yu@example.com",
    channel: "AWS Bedrock",
    purpose: "海外站点需要在弗吉尼亚区域就近推理，降低首字延迟",
    submittedAt: "10-09 15:03",
    status: "已通过",
  },
  {
    applicant: "周涵",
    contact: "zhou.han@example.com",
    channel: "Azure OpenAI",
    purpose: "金融客户要求数据不出境，需要走 Azure 合规通道",
    submittedAt: "10-08 20:11",
    status: "已驳回",
    rejectReason: "当前企业资质材料缺失，补齐后重新提交",
  },
  {
    applicant: "吴欣",
    contact: "wu.xin@example.com",
    channel: "OpenAI 官方直连",
    purpose: "帮朋友的工作室跑一批文案，需求量未知",
    submittedAt: "10-08 16:47",
    status: "已驳回",
    rejectReason: "用途描述过于笼统，无法评估调用规模",
  },
  {
    applicant: "郑培",
    contact: "zheng.pei@example.com",
    channel: "Moonshot Kimi",
    purpose: "长文档解析与合同比对，主要用于月均 5 万页的审阅场景",
    submittedAt: "10-08 09:55",
    status: "待处理",
  },
];

const stats = [
  { label: "待处理", value: "4", hint: "其中 1 条已超过 24 小时" },
  { label: "本月通过", value: formatNumber(46), hint: "较上月 +11" },
  { label: "本月驳回", value: formatNumber(9), hint: "驳回率 16.4%" },
  { label: "平均处理时长", value: "6.4 小时", hint: "目标 12 小时以内" },
];

const statusTabs = ["全部", "待处理", "已通过", "已驳回"] as const;

function badgeVariant(status: ApplicationStatus) {
  if (status === "已通过") return "success" as const;
  if (status === "已驳回") return "destructive" as const;
  return "warning" as const;
}

/** 通过申请会产生什么影响，文案里带申请人邮箱与渠道名 */
function passNote(item: Application) {
  return `通过后 ${item.contact} 立刻获得 ${item.channel} 的调用权限，额度沿用当前套餐的限额。`;
}

export default function DashboardChannelApplications() {
  const [status, setStatus] = createSignal<(typeof statusTabs)[number]>("全部");

  const filtered = createMemo(() => {
    if (status() === "全部") return applications;
    return applications.filter(item => item.status === status());
  });

  return (
    <>
      <Title>渠道申请 | TokenMP 销售控制台</Title>

      <PageHeader description="审核客户提交的模型渠道开通申请，通过后立即生效" />

      <StatRow items={stats} />

      <Card class="overflow-hidden">
        <div class="flex flex-wrap items-center gap-3 border-b p-4">
          <Segmented options={statusTabs} value={status()} onChange={setStatus} ariaLabel="状态筛选" />

          <p class="text-sm text-muted-foreground">
            当前筛选 {formatNumber(filtered().length)} 条申请
          </p>
        </div>

        <Table tableClass="min-w-[960px]">
          <TableHeader>
            <TableRow>
              <TableHead>申请人</TableHead>
              <TableHead>申请渠道</TableHead>
              <TableHead>用途说明</TableHead>
              <TableHead>提交时间</TableHead>
              <TableHead>状态</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={filtered()}>
              {(item, index) => (
                <TableRow>
                  <TableCell>
                    <div class="flex flex-col gap-0.5">
                      <span class="font-medium">{item.applicant}</span>
                      <span class="text-xs text-muted-foreground">{item.contact}</span>
                    </div>
                  </TableCell>
                  <TableCell class="text-muted-foreground">{item.channel}</TableCell>
                  <TableCell class="max-w-[24rem] text-muted-foreground">{item.purpose}</TableCell>
                  <TableCell class="whitespace-nowrap tabular-nums text-muted-foreground">
                    {item.submittedAt}
                  </TableCell>
                  <TableCell>
                    <div class="flex flex-col gap-1">
                      <Badge variant={badgeVariant(item.status)}>{item.status}</Badge>
                      <Show when={item.rejectReason}>
                        <span class="max-w-[16rem] text-xs text-muted-foreground">
                          {item.rejectReason}
                        </span>
                      </Show>
                    </div>
                  </TableCell>
                  <TableCell class="text-right">
                    <Show
                      when={item.status === "待处理"}
                      fallback={<span class="text-xs text-muted-foreground">已处理</span>}
                    >
                      <div class="flex items-center justify-end gap-2">
                        <Dialog
                          trigger={
                            <>
                              <Check class="size-4" />通过
                            </>
                          }
                          triggerLabel={`通过 ${item.applicant} 的申请`}
                          title="通过这条渠道申请？"
                          description={`${item.applicant} · ${item.channel}`}
                          footer={
                            <>
                              <DialogClose>取消</DialogClose>
                              <DialogClose variant="default">确认通过</DialogClose>
                            </>
                          }
                        >
                          <div class="space-y-2 text-muted-foreground">
                            <p>{passNote(item)}</p>
                            <p>提交时间：{item.submittedAt}</p>
                            <p>用途说明：{item.purpose}</p>
                          </div>
                        </Dialog>

                        <Dialog
                          trigger={
                            <span class="flex items-center gap-1.5 text-destructive-text">
                              <X class="size-4" />驳回
                            </span>
                          }
                          triggerLabel={`驳回 ${item.applicant} 的申请`}
                          title="驳回这条渠道申请？"
                          description={`${item.applicant} · ${item.channel}`}
                          footer={
                            <>
                              <DialogClose>取消</DialogClose>
                              <DialogClose variant="destructive">确认驳回</DialogClose>
                            </>
                          }
                        >
                          <div class="space-y-2">
                            <Label for={`reject-reason-${index()}`}>驳回理由</Label>
                            <Input
                              id={`reject-reason-${index()}`}
                              placeholder="例如：用途描述不清晰，请补充具体业务场景与调用规模"
                            />
                            <p class="text-muted-foreground">
                              理由会随通知一起发给申请人，写清楚需要补充的材料，方便对方改完再提交。
                            </p>
                          </div>
                        </Dialog>
                      </div>
                    </Show>
                  </TableCell>
                </TableRow>
              )}
            </For>
            <Show when={filtered().length === 0}>
              <TableRow>
                <TableCell class="py-10 text-center text-muted-foreground" colSpan={6}>
                  这个状态下暂时没有申请
                </TableCell>
              </TableRow>
            </Show>
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
