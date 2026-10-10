import { Title } from "@solidjs/meta";
import ArrowDown from "lucide-solid/icons/arrow-down";
import ArrowUp from "lucide-solid/icons/arrow-up";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import Search from "lucide-solid/icons/search";
import Workflow from "lucide-solid/icons/workflow";
import X from "lucide-solid/icons/x";
import { createMemo, createSignal, For, Show } from "solid-js";

import { PageHeader } from "~/components/layout/page-header";
import { ResponsiveTable } from "~/components/panel/responsive-table";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Dialog } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Sheet, SheetClose } from "~/components/ui/sheet";
import {
  autoChain as seedChain,
  catalogModels,
  catalogUpdatedAt,
  currentPlan,
  type CatalogModel,
} from "~/lib/panel-data";
import { formatDateTime, formatPoints } from "~/lib/utils";

/** supports 里的能力代号 → 给人看的名字。多个代号指向同一个名字的去重 */
const CAPABILITY_LABELS: Record<string, string> = {
  chat: "文本生成",
  messages: "文本生成",
  responses: "文本生成",
  tools: "工具调用",
  vision: "视觉",
  reasoning: "推理",
  cache: "缓存",
  embeddings: "向量",
};

const SOURCE_LABELS: Record<string, string> = {
  official: "官方",
  user: "用户分享",
  platform: "平台",
};

/** 用户看到的单价 = 上游成本 × 套餐倍率。单位是积分 / 百万 token */
function unitPrice(cost: number | null | undefined) {
  const markup = currentPlan.plan.markup_multiplier ?? 1;
  return formatPoints((cost ?? 0) * markup);
}

function capabilities(model: CatalogModel) {
  const labels = new Set<string>();
  for (const channel of model.channels) {
    for (const support of channel.supports) {
      labels.add(CAPABILITY_LABELS[support] ?? support);
    }
  }
  return [...labels];
}

/** 按最优输入价路由：挑输入成本最低的那条渠道 */
function bestChannel(model: CatalogModel) {
  return [...model.channels].sort(
    (a, b) => a.cost_input_per_million - b.cost_input_per_million,
  )[0];
}

/**
 * 模型目录。
 *
 * 用户关心的三件事：有哪些模型、走谁的上游、多少钱。所以主表就是
 * 模型 / 能力 / 上游 / 参考价，每行的「明细」里再摊开渠道与账号。
 *
 * 线上那张表还带倍率规则、阶梯计价这些销售侧配置，本机不做 ——
 * 那是控制台的活，用户面板里看到只会更糊涂。
 */
export default function PanelModels() {
  const [keyword, setKeyword] = createSignal("");
  const [chain, setChain] = createSignal<string[]>(seedChain);
  const [chainOpen, setChainOpen] = createSignal(false);
  const [refreshed, setRefreshed] = createSignal(false);

  const filtered = createMemo(() => {
    const query = keyword().trim().toLowerCase();
    if (!query) return catalogModels;
    return catalogModels.filter(model => {
      if (model.model.toLowerCase().includes(query)) return true;
      return model.channels.some(
        channel =>
          channel.name.toLowerCase().includes(query) ||
          channel.accounts.some(account => account.name.toLowerCase().includes(query)),
      );
    });
  });

  const available = () =>
    catalogModels
      .map(model => model.model)
      .filter(name => !chain().includes(name));

  const move = (index: number, offset: number) => {
    const next = [...chain()];
    const target = index + offset;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setChain(next);
  };

  const refresh = () => {
    setRefreshed(true);
    window.setTimeout(() => setRefreshed(false), 2000);
  };

  return (
    <>
      <Title>模型目录 | TokenMP 用户面板</Title>

      <PageHeader description="平台可用模型与上游、账号、参考价">
        <Button variant="outline" onClick={() => setChainOpen(true)}>
          <Workflow class="size-4" aria-hidden="true" />
          降级链
          <Badge variant="secondary" class="ml-1">
            {chain().length}
          </Badge>
        </Button>
        <Button variant="outline" onClick={refresh}>
          <RefreshCw class="size-4" aria-hidden="true" />
          {refreshed() ? "已是最新" : "刷新目录"}
        </Button>
      </PageHeader>

      <Card class="overflow-hidden">
        <div class="flex flex-wrap items-center gap-2 border-b p-4">
          <div class="relative w-full sm:w-72">
            <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              class="pl-8"
              placeholder="搜索模型 / 渠道 / 账号"
              aria-label="搜索模型"
              value={keyword()}
              onInput={event => setKeyword(event.currentTarget.value)}
            />
          </div>
          <p class="text-sm text-muted-foreground lg:ml-auto">
            共 {filtered().length} 个模型 · 目录更新于 {formatDateTime(catalogUpdatedAt)}
          </p>
        </div>

        <ResponsiveTable
          items={filtered()}
          rowKey={model => model.model}
          columns={[
            {
              header: "模型",
              cell: model => <span class="font-medium">{model.model}</span>,
            },
            {
              header: "能力",
              cell: model => (
                <div class="flex flex-wrap gap-1">
                  <For each={capabilities(model)}>
                    {label => <Badge variant="secondary">{label}</Badge>}
                  </For>
                </div>
              ),
            },
            {
              header: "上游",
              cell: model => (
                <div>
                  <p>
                    {model.channels.length} 条路由 · 按最优输入价路由（
                    {bestChannel(model).name}）
                  </p>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    {model.channels.map(channel => channel.name).join(" / ")}
                  </p>
                </div>
              ),
            },
            {
              header: "参考价（积分 / 百万 token）",
              cell: model => (
                <div class="tabular-nums">
                  <p>输入 {unitPrice(bestChannel(model).cost_input_per_million)}</p>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    输出 {unitPrice(bestChannel(model).cost_output_per_million)}
                  </p>
                </div>
              ),
            },
          ]}
          cardTitle={model => model.model}
          cardSubtitle={model =>
            `${model.channels.length} 条路由 · 输入 ${unitPrice(
              bestChannel(model).cost_input_per_million,
            )} / 输出 ${unitPrice(bestChannel(model).cost_output_per_million)} 积分每百万 token`
          }
          actions={model => (
            <Sheet
              trigger="明细"
              title={model.model}
              description={`${model.channels.length} 个上游 · 按最优输入价路由`}
              footer={<SheetClose>关闭</SheetClose>}
            >
              <ChannelDetail model={model} />
            </Sheet>
          )}
          empty={keyword() ? "没有匹配的模型" : "暂无可用模型"}
          emptyDescription={keyword() ? "试试调整搜索词" : "平台尚未配置渠道"}
        />
      </Card>

      {/* 降级链：model 传 auto 时的顺序 */}
      <Dialog
        open={chainOpen()}
        onOpenChange={setChainOpen}
        title={'配置 model:"auto" 的降级顺序'}
        description="请求失败时按这个顺序往下试，排在前面的先调用"
        footer={
          <>
            <Button variant="outline" onClick={() => setChain(seedChain)}>
              恢复默认
            </Button>
            <Button onClick={() => setChainOpen(false)}>保存</Button>
          </>
        }
      >
        <div>
          <p class="text-sm font-semibold">当前顺序</p>
          <p class="mb-2 mt-0.5 text-xs text-muted-foreground">
            排在前面的优先，失败后自动降级到下一个
          </p>
          <Show
            when={chain().length > 0}
            fallback={<p class="text-sm text-muted-foreground">还没有配置，传 auto 会按平台默认顺序路由</p>}
          >
            <ol class="space-y-1.5">
              <For each={chain()}>
                {(model, index) => (
                  <li class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <span class="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs tabular-nums">
                      {index() + 1}
                    </span>
                    <span class="min-w-0 flex-1 truncate font-medium">{model}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-7"
                      aria-label={`上移 ${model}`}
                      disabled={index() === 0}
                      onClick={() => move(index(), -1)}
                    >
                      <ArrowUp class="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-7"
                      aria-label={`下移 ${model}`}
                      disabled={index() === chain().length - 1}
                      onClick={() => move(index(), 1)}
                    >
                      <ArrowDown class="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-7 text-destructive-text"
                      aria-label={`从降级链移除 ${model}`}
                      onClick={() => setChain(prev => prev.filter(name => name !== model))}
                    >
                      <X class="size-3.5" />
                    </Button>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </div>

        <div class="mt-5">
          <Select
            label="添加模型"
            placeholder={
              available().length > 0 ? "选择要加入降级链的模型" : "目录里的模型都已在上面的链上"
            }
            options={available().map(model => ({ value: model, label: model }))}
            // 选了就往链尾追加，选完自动回到 placeholder：这是个「执行动作」的下拉，
            // 不是「保存选中项」的下拉
            value={null}
            onChange={model => setChain(prev => [...prev, model])}
            disabled={available().length === 0}
            portal={false}
          />
        </div>
      </Dialog>
    </>
  );
}

/**
 * 一条模型上挂了哪些渠道与账号。
 *
 * 原来渠道下面摆的是四列表格（输入/输出/账号/类型），抽屉放宽到 512px 之后
 * 依然放不下，账号名与类型都被右边缘切掉 —— 「类型」本来就跟着账号名重复一次。
 * 改成单价两格 + 账号标签，一眼看得完，也不用横滚。
 */
function ChannelDetail(props: { model: CatalogModel }) {
  return (
    <div class="space-y-3">
      <For each={props.model.channels}>
        {channel => (
          <section class="rounded-lg border p-3">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-sm font-medium">{channel.name}</h3>
              <Badge variant="outline">{SOURCE_LABELS[channel.source] ?? channel.source}</Badge>
              <Show when={channel.user_shared}>
                <Badge variant="secondary">用户分享</Badge>
              </Show>
            </div>

            <p class="mt-1.5 break-all font-mono text-xs text-muted-foreground">{channel.base_url}</p>
            <p class="mt-1 text-xs text-muted-foreground">支持 {channel.supports.join("、")}</p>

            <dl class="mt-2.5 grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border">
              <div class="bg-card px-3 py-2">
                <dt class="text-xs text-muted-foreground">输入</dt>
                <dd class="mt-0.5 text-sm font-medium tabular-nums">
                  {unitPrice(channel.cost_input_per_million)} 积分/M
                </dd>
              </div>
              <div class="bg-card px-3 py-2">
                <dt class="text-xs text-muted-foreground">输出</dt>
                <dd class="mt-0.5 text-sm font-medium tabular-nums">
                  {unitPrice(channel.cost_output_per_million)} 积分/M
                </dd>
              </div>
            </dl>

            <p class="mt-2.5 text-xs text-muted-foreground">
              账号（{channel.accounts.length}）
            </p>
            <ul class="mt-1.5 flex flex-wrap gap-1.5">
              <For each={channel.accounts}>
                {account => (
                  <li class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                    <span class="font-mono">{account.name}</span>
                    <span class="text-muted-foreground">
                      {account.owner === "user" ? "用户" : "平台"}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </section>
        )}
      </For>

      <p class="text-xs text-muted-foreground">
        {props.model.channels.length} 个上游 · 按最优路由计价（挑输入价最低的一条）
      </p>
    </div>
  );
}
