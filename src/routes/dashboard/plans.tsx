import { Title } from "@solidjs/meta";
import CircleCheck from "lucide-solid/icons/circle-check";
import Plus from "lucide-solid/icons/plus";
import Users from "lucide-solid/icons/users";
import { For, Show } from "solid-js";

import { PageHeader } from "~/components/layout/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { cn, formatNumber } from "~/lib/utils";

// 设计样板用的示例数据，接后端时替换
type Plan = {
  name: string;
  price: string;
  quota: string;
  features: string[];
  subscribers: number;
  recommended?: boolean;
};

const plans: Plan[] = [
  {
    name: "按量付费",
    price: "$0",
    quota: "没有月费，用多少算多少，余额实时扣减。",
    features: [
      "全量模型按原价调用",
      "余额充值 10 美元起",
      "按秒计费的用量明细",
      "API 密钥 3 个",
    ],
    subscribers: 8642,
  },
  {
    name: "标准版",
    price: "$69",
    quota: "每月含 300 万 Token 额度，超出部分按量计费。",
    features: [
      "每月 300 万 Token 额度",
      "OpenAI、Anthropic、Gemini 全量模型",
      "API 密钥 10 个，支持项目隔离",
      "账单与用量明细导出",
      "工单支持，24 小时内响应",
    ],
    subscribers: 1284,
  },
  {
    name: "专业版",
    price: "$199",
    quota: "每月含 1200 万 Token 额度，适合稳定跑生产环境。",
    features: [
      "每月 1200 万 Token 额度，单价 8 折",
      "高并发通道，独立限流配额",
      "上游故障自动切换与重试",
      "子账户 5 个，按项目分账",
      "工单优先支持，4 小时内响应",
    ],
    subscribers: 476,
    recommended: true,
  },
  {
    name: "企业版",
    price: "$1990",
    quota: "每月含 1.5 亿 Token 额度，支持对公结算与年度合同。",
    features: [
      "每月 1.5 亿 Token 额度，单价 6 折",
      "专属通道，可选私有化部署",
      "子账户不限，支持 SSO 与审计日志",
      "开具发票，支持对公转账",
      "专属客户经理，1 小时内响应",
      "99.9% 可用性承诺",
    ],
    subscribers: 38,
  },
];

const included = [
  "同一把密钥调用全部渠道，换模型不用改代码",
  "请求失败自动重试，重试的调用不额外计费",
  "余额与套餐额度实时扣减，没有隐藏费用",
  "用量、账单、调用日志随时导出 CSV",
  "密钥权限隔离，支持 IP 白名单",
  "套餐升降级当天生效，剩余额度按天折算",
];

export default function DashboardPlans() {
  return (
    <>
      <Title>套餐 | TokenMP 销售控制台</Title>

      <PageHeader description="四个在售套餐，定价、额度与订阅情况一览。">
        <Button>
          <Plus class="size-4" />
          新建套餐
        </Button>
      </PageHeader>

      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <For each={plans}>
          {plan => (
            <Card
              class={cn(
                "flex flex-col p-5",
                plan.recommended && "ring-2 ring-primary",
              )}
            >
              <div class="flex items-center gap-2">
                <h2 class="font-semibold tracking-tight">{plan.name}</h2>
                <Show when={plan.recommended}>
                  <Badge>推荐</Badge>
                </Show>
              </div>

              <p class="mt-3 flex items-baseline gap-1">
                <span class="text-2xl font-semibold tabular-nums tracking-tight">
                  {plan.price}
                </span>
                <span class="text-sm text-muted-foreground">/ 月</span>
              </p>
              <p class="mt-1.5 text-sm text-muted-foreground">{plan.quota}</p>

              <ul class="mt-4 space-y-2 text-sm">
                <For each={plan.features}>
                  {feature => (
                    <li class="flex items-start gap-2">
                      <CircleCheck class="mt-0.5 size-4 shrink-0 text-success-text" />
                      <span class="text-muted-foreground">{feature}</span>
                    </li>
                  )}
                </For>
              </ul>

              <div class="mt-auto">
                <div class="mt-5 flex items-center gap-1.5 border-t pt-4 text-sm text-muted-foreground">
                  <Users class="size-4 shrink-0" />
                  <span class="tabular-nums">{formatNumber(plan.subscribers)} 位订阅</span>
                </div>
                <div class="mt-3 flex items-center gap-2">
                  <Button variant="outline" class="flex-1">
                    编辑
                  </Button>
                  <Button variant="ghost" class="flex-1 text-destructive-text">
                    停用
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </For>
      </div>

      <Card class="mt-4 p-5">
        <h2 class="font-semibold tracking-tight">所有套餐都包含</h2>
        <p class="mt-1 text-sm text-muted-foreground">不计入额度的通用能力</p>
        <ul class="mt-4 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <For each={included}>
            {item => (
              <li class="flex items-start gap-2">
                <CircleCheck class="mt-0.5 size-4 shrink-0 text-success-text" />
                <span class="text-muted-foreground">{item}</span>
              </li>
            )}
          </For>
        </ul>
      </Card>
    </>
  );
}
