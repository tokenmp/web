import { Title } from "@solidjs/meta";
import CircleCheck from "lucide-solid/icons/circle-check";
import Pencil from "lucide-solid/icons/pencil";
import Plus from "lucide-solid/icons/plus";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import Trash from "lucide-solid/icons/trash";
import Users from "lucide-solid/icons/users";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";

import { PageHeader, StatRow } from "~/components/layout/page-header";
import { DetailRow } from "~/components/panel/detail-row";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Dialog } from "~/components/ui/dialog";
import { EmptyState } from "~/components/ui/empty-state";
import { ErrorState } from "~/components/ui/error-state";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { PagerIfNeeded } from "~/components/ui/pager";
import { Segmented } from "~/components/ui/segmented";
import { Select } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Toolbar, ToolbarDivider, ToolbarSpacer } from "~/components/ui/toolbar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";
import {
  buildPlanInput,
  buildPriceInput,
  COST_MODE_LABELS,
  COST_MODE_OPTIONS,
  createPlan,
  createPlanPrice,
  deletePlanPrice,
  disablePlan,
  fetchPlanActivationHistory,
  fetchPlanActivationSummary,
  fetchPlanActivations,
  fetchPlanDetail,
  fetchPlans,
  formatPlanMoney,
  MODE_OPTIONS,
  OVERAGE_MODE_LABELS,
  OVERAGE_MODE_OPTIONS,
  PLAN_MODE_LABELS,
  planQuotaText,
  PRICING_MODE_LABELS,
  PRICING_MODE_OPTIONS,
  QUOTA_KIND_LABELS,
  QUOTA_KIND_OPTIONS,
  restorePlan,
  type ActivationExpire,
  type OverageMode,
  type Plan,
  type PlanActivation,
  type PlanActivationHistoryItem,
  type PlanCostMode,
  type PlanDetail,
  type PlanMode,
  type PlanPrice,
  type PricingMode,
  type QuotaKind,
  updatePlan,
} from "~/lib/admin-plans";
import { createClientResource } from "~/lib/resource";
import { cn, formatDate, formatNumber, formatYuan, isExpired } from "~/lib/utils";

const EXPIRE_OPTIONS: { value: ActivationExpire; label: string }[] = [
  { value: "", label: "全部" },
  { value: "7d", label: "7 天内到期" },
  { value: "expired", label: "已过期" },
];

/**
 * 「所有套餐都包含」那张卡片的条目。
 *
 * 只写本仓库能兑现的：自动重试在内核侧（openapi 里那组重试配置属于 remote 端点）、
 * CSV 导出没有实现、密钥只有模型白名单而没有 IP 白名单，这三条都不是本机的承诺，
 * 摆在这里等于对着做不到的事做宣传。
 */
const HERO_FEATURES = [
  "同一把密钥调用全部渠道，换模型不用改代码",
  "余额与订阅额度实时扣减，没有隐藏费用",
  "套餐升降级当天生效，剩余订阅额度按天折算",
];

/**
 * 套餐页。
 *
 * 卡片是销售页的样子，读的是 /api/admin/plans，不再是写死的四档。
 * 数据分三块：套餐列表（含「含已停用」开关）、四个概览数字、订阅激活列表。
 *
 * 「停用」是软删（status=0），默认列表看不到，切「含已停用」才现身；
 * 已停用的卡片给「恢复」按钮，调 POST /api/admin/plans/{id}/enable 把它置回在售。
 */
export default function DashboardPlans() {
  const [includeDeleted, setIncludeDeleted] = createSignal(false);
  const [notice, setNotice] = createSignal("");

  const plans = createClientResource(
    () => fetchPlans(includeDeleted()),
    { items: [] as Plan[], total: 0 },
  );
  const summary = createClientResource(fetchPlanActivationSummary, {
    subscribers: 0,
    month_revenue: 0,
    week_activations: 0,
    expiring_7d: 0,
  });

  // 「含已停用」切换后重新拉一次；首帧那次交给 createClientResource 自己的 onMount
  createEffect(on(includeDeleted, () => void plans.reload(), { defer: true }));

  const [formOpen, setFormOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<Plan | null>(null);
  const [pendingDisable, setPendingDisable] = createSignal<Plan | null>(null);
  const [disablePending, setDisablePending] = createSignal(false);
  const [pendingRestore, setPendingRestore] = createSignal<Plan | null>(null);
  const [restorePending, setRestorePending] = createSignal(false);

  const [detailOpen, setDetailOpen] = createSignal(false);
  const [detailId, setDetailId] = createSignal<number | null>(null);

  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [historyTarget, setHistoryTarget] = createSignal<PlanActivation | null>(null);

  const stats = () => [
    { label: "活跃订阅用户", value: formatNumber(summary.data().subscribers), hint: "去重后的用户数" },
    { label: "本月订阅收入", value: formatYuan(summary.data().month_revenue), hint: "本自然月新增订阅" },
    { label: "近 7 天激活", value: formatNumber(summary.data().week_activations), hint: "新增订阅行数" },
    { label: "7 天内到期", value: formatNumber(summary.data().expiring_7d), hint: "需要提醒续费" },
  ];

  const openForm = (plan: Plan | null) => {
    setNotice("");
    setEditing(plan);
    setFormOpen(true);
  };

  const openDetail = (plan: Plan) => {
    setNotice("");
    setDetailId(plan.id);
    setDetailOpen(true);
  };

  const refreshAll = () => {
    void plans.reload();
    void summary.reload();
  };

  const confirmDisable = async () => {
    const plan = pendingDisable();
    if (!plan || disablePending()) return;
    setDisablePending(true);
    setNotice("");
    try {
      await disablePlan(plan.id);
      setPendingDisable(null);
      refreshAll();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "停用失败");
    } finally {
      setDisablePending(false);
    }
  };

  // 恢复也走二次确认，与停用对称；恢复不涉及破坏性操作，确认文案写清后果即可
  const confirmRestore = async () => {
    const plan = pendingRestore();
    if (!plan || restorePending()) return;
    setRestorePending(true);
    setNotice("");
    try {
      await restorePlan(plan.id);
      setPendingRestore(null);
      refreshAll();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setRestorePending(false);
    }
  };

  /* ------------------------------------------------------------ 订阅列表 */

  const [actPage, setActPage] = createSignal(1);
  const [actSize, setActSize] = createSignal(20);
  const [actPlanId, setActPlanId] = createSignal("");
  const [actExpire, setActExpire] = createSignal<ActivationExpire>("");
  const [actUserId, setActUserId] = createSignal("");

  const activations = createClientResource(
    () =>
      fetchPlanActivations({
        page: actPage(),
        size: actSize(),
        planId: Number(actPlanId()) || undefined,
        userId: Number(actUserId()) || undefined,
        expire: actExpire(),
      }),
    { items: [] as PlanActivation[], total: 0 },
  );

  // 筛选条件变了回到第一页。页码与每页条数的变化走各自的处理函数，
  // 不放在这个 effect 里，免得一次改动触发两次请求。
  createEffect(
    on(
      [actPlanId, actExpire, actUserId],
      () => {
        setActPage(1);
        void activations.reload();
      },
      { defer: true },
    ),
  );

  const changeActPage = (page: number) => {
    setActPage(page);
    void activations.reload();
  };

  const changeActSize = (size: number) => {
    setActPage(1);
    setActSize(size);
    void activations.reload();
  };

  const planOptions = createMemo(() => [
    { value: "", label: "全部套餐" },
    ...plans.data().items.map(plan => ({ value: String(plan.id), label: plan.name })),
  ]);

  const openHistory = (item: PlanActivation) => {
    setHistoryTarget(item);
    setHistoryOpen(true);
  };

  return (
    <>
      <Title>套餐 | tokenmp web</Title>

      <PageHeader>
        <Switch checked={includeDeleted()} onChange={setIncludeDeleted} label="含已停用" />
        <Button onClick={() => openForm(null)}>
          <Plus class="size-4" aria-hidden="true" />
          新建套餐
        </Button>
      </PageHeader>

      <Show when={summary.error()}>
        <ErrorState
          class="mb-4 rounded-lg border border-destructive/30"
          message={summary.error()!}
          onRetry={() => void summary.reload()}
        />
      </Show>

      <StatRow items={stats()} />

      <Show when={notice()}>
        <p
          class="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive-text"
          role="alert"
        >
          {notice()}
        </p>
      </Show>

      <Show when={plans.error()}>
        <ErrorState
          class="mb-4 rounded-lg border border-destructive/30"
          message={plans.error()!}
          onRetry={() => void plans.reload()}
        />
      </Show>

      <Show
        when={plans.data().items.length > 0}
        fallback={
          <Show when={!plans.error()}>
            <EmptyState
              title={plans.loading() ? "正在加载…" : "还没有套餐"}
              description={plans.loading() ? undefined : "点右上角「新建套餐」建第一个"}
            />
          </Show>
        }
      >
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <For each={plans.data().items}>
            {plan => (
              <PlanCard
                plan={plan}
                onDetail={() => openDetail(plan)}
                onEdit={() => openForm(plan)}
                onDisable={() => setPendingDisable(plan)}
                onRestore={() => setPendingRestore(plan)}
              />
            )}
          </For>
        </div>
      </Show>

      <Card class="mt-6 overflow-hidden">
        <Toolbar>
          <div>
            <h2 class="font-semibold tracking-tight">订阅与激活</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">按用户聚合</p>
          </div>

          <ToolbarSpacer />

          <Select
            label="套餐"
            labelPlacement="inline"
            class="w-44"
            options={planOptions()}
            value={actPlanId()}
            onChange={setActPlanId}
            placeholder="全部套餐"
          />
          <Label
            for="activation-user"
            class="shrink-0 whitespace-nowrap text-muted-foreground"
          >
            用户 ID
          </Label>
          <Input
            id="activation-user"
            type="number"
            min="1"
            class="w-28"
            placeholder="全部"
            value={actUserId()}
            onInput={event => setActUserId(event.currentTarget.value)}
          />
          <ToolbarDivider />
          <Segmented
            options={EXPIRE_OPTIONS}
            value={actExpire()}
            onChange={setActExpire}
            ariaLabel="按到期时间筛选订阅"
          />
        </Toolbar>

        <Show when={activations.error()}>
          <ErrorState
            variant="inline"
            class="border-b px-4"
            message={activations.error()!}
            onRetry={() => void activations.reload()}
          />
        </Show>

        <Table tableClass="min-w-[860px]">
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>当前套餐</TableHead>
              <TableHead>本周期订阅额度</TableHead>
              <TableHead>周期</TableHead>
              <TableHead class="text-right">累计消费</TableHead>
              <TableHead class="text-right">激活次数</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={activations.data().items}>
              {item => (
                <TableRow>
                  <TableCell>
                    <p class="font-medium">{item.user_name}</p>
                    <p class="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      #{item.user_id}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p>{item.plan_name}</p>
                    <Badge variant="secondary" class="mt-1">
                      {PLAN_MODE_LABELS[item.plan_mode] ?? item.plan_mode}
                    </Badge>
                  </TableCell>
                  <TableCell class="tabular-nums text-muted-foreground">
                    {item.quota_kind === "requests"
                      ? `${formatNumber(item.quota_used)} / ${formatNumber(item.quota_limit)} 次`
                      : `${formatYuan(item.quota_used)} / ${formatYuan(item.quota_limit)}`}
                  </TableCell>
                  <TableCell class="text-muted-foreground">
                    <p class="tabular-nums">
                      {formatDate(item.period_start)} ~ {formatDate(item.period_end)}
                    </p>
                    <Show when={isExpired(item.period_end)}>
                      <Badge variant="warning" class="mt-1">
                        已过期
                      </Badge>
                    </Show>
                  </TableCell>
                  <TableCell class="text-right tabular-nums">{formatYuan(item.total_spend)}</TableCell>
                  <TableCell class="text-right tabular-nums">
                    {formatNumber(item.activation_count)}
                  </TableCell>
                  <TableCell class="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`查看 ${item.user_name} 的续费历史`}
                      onClick={() => openHistory(item)}
                    >
                      续费历史
                    </Button>
                  </TableCell>
                </TableRow>
              )}
            </For>

            <Show when={activations.data().items.length === 0}>
              <TableRow>
                <TableCell class="py-10 text-center text-muted-foreground" colSpan={7}>
                  {activations.loading() ? "正在加载…" : "没有符合条件的订阅"}
                </TableCell>
              </TableRow>
            </Show>
          </TableBody>
        </Table>

        <PagerIfNeeded
          page={actPage()}
          size={actSize()}
          total={activations.data().total}
          onPageChange={changeActPage}
          onSizeChange={changeActSize}
        />
      </Card>

      <Card class="mt-4 p-5">
        <h2 class="font-semibold tracking-tight">所有套餐都包含</h2>
        <p class="mt-1 text-sm text-muted-foreground">不计入订阅额度的通用能力</p>
        <ul class="mt-4 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <For each={HERO_FEATURES}>
            {item => (
              <li class="flex items-start gap-2">
                <CircleCheck class="mt-0.5 size-4 shrink-0 text-success-text" />
                <span class="text-muted-foreground">{item}</span>
              </li>
            )}
          </For>
        </ul>
      </Card>

      <PlanFormDialog
        open={formOpen()}
        plan={editing()}
        onOpenChange={setFormOpen}
        onSaved={refreshAll}
      />

      <PlanDetailDialog open={detailOpen()} planId={detailId()} onOpenChange={setDetailOpen} />

      <ActivationHistoryDialog
        open={historyOpen()}
        target={historyTarget()}
        onOpenChange={setHistoryOpen}
      />

      <Dialog
        open={pendingDisable() !== null}
        onOpenChange={open => {
          if (!open) setPendingDisable(null);
        }}
        title="停用这个套餐？"
        description="停用是软删：套餐从默认列表里消失，名字仍被占用（再建同名会 409），名下的模型价会被直接删掉。已经订阅的用户不受影响。"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDisable(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={disablePending()}
              onClick={() => void confirmDisable()}
            >
              {disablePending() ? "停用中…" : "停用"}
            </Button>
          </>
        }
      />

      <Dialog
        open={pendingRestore() !== null}
        onOpenChange={open => {
          if (!open) setPendingRestore(null);
        }}
        title="恢复这个套餐？"
        description="恢复后套餐回到默认列表并重新在售（status 置回 1）。停用时被删掉的模型价不会自动回来，需要到「详情」里重新加。"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingRestore(null)}>
              取消
            </Button>
            <Button disabled={restorePending()} onClick={() => void confirmRestore()}>
              {restorePending() ? "恢复中…" : "恢复"}
            </Button>
          </>
        }
      />
    </>
  );
}

/* ------------------------------------------------------------------ 卡片 */

function PlanCard(props: {
  plan: Plan;
  onDetail: () => void;
  onEdit: () => void;
  onDisable: () => void;
  onRestore: () => void;
}) {
  const plan = () => props.plan;

  return (
    <Card
      class={cn(
        "flex flex-col p-5",
        plan().recommended === 1 && "ring-2 ring-primary",
        plan().status === 0 && "border-dashed opacity-70",
      )}
    >
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="font-semibold tracking-tight">{plan().name}</h2>
        <Show when={plan().recommended === 1}>
          <Badge>推荐</Badge>
        </Show>
        <Show when={plan().status === 0}>
          <Badge variant="secondary">已停用</Badge>
        </Show>
      </div>

      <p class="mt-1 text-xs text-muted-foreground">
        {PLAN_MODE_LABELS[plan().mode] ?? plan().mode} ·{" "}
        {PRICING_MODE_LABELS[plan().pricing_mode] ?? plan().pricing_mode}
      </p>

      <p class="mt-3 flex items-baseline gap-1">
        <span class="text-2xl font-semibold tabular-nums tracking-tight">
          {formatPlanMoney(plan().price, plan().currency)}
        </span>
        <span class="text-sm text-muted-foreground">
          {plan().mode === "subscription" ? `每 ${plan().quota_period_days} 天` : "按量计费"}
        </span>
      </p>
      <p class="mt-1.5 text-sm text-muted-foreground">{planQuotaText(plan())}</p>

      <Show when={plan().features.length > 0}>
        <ul class="mt-4 space-y-2 text-sm">
          <For each={plan().features}>
            {feature => (
              <li class="flex items-start gap-2">
                <CircleCheck class="mt-0.5 size-4 shrink-0 text-success-text" />
                <span class="text-muted-foreground">{feature}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <div class="mt-auto">
        <div class="mt-5 flex items-center gap-1.5 border-t pt-4 text-sm text-muted-foreground">
          <Users class="size-4 shrink-0" />
          <span class="tabular-nums">{formatNumber(plan().subscribers ?? 0)} 位订阅</span>
        </div>
        <div class="mt-3 flex items-center gap-2">
          <Button variant="outline" size="sm" class="flex-1" onClick={() => props.onDetail()}>
            详情
          </Button>
          <Button variant="outline" size="sm" class="flex-1" onClick={() => props.onEdit()}>
            <Pencil class="size-3.5" aria-hidden="true" />
            编辑
          </Button>
          <Show when={plan().status === 1}>
            <Button
              variant="ghost"
              size="sm"
              class="flex-1 text-destructive-text"
              onClick={() => props.onDisable()}
            >
              <Trash class="size-3.5" aria-hidden="true" />
              停用
            </Button>
          </Show>
          <Show when={plan().status === 0}>
            <Button variant="outline" size="sm" class="flex-1" onClick={() => props.onRestore()}>
              <RotateCcw class="size-3.5" aria-hidden="true" />
              恢复
            </Button>
          </Show>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- 新建/编辑 */

/**
 * 新建与编辑共用一个弹窗。
 *
 * 打开时把表单的每个字段都填成当前这条套餐的值，提交时再由 buildPlanInput
 * 产出带齐全部字段的请求体 —— PUT 是整体替换，漏掉的字段会被后端写成列默认值
 * （quota_amount=0、markup_multiplier=1 之类），不是「保持原样」。
 * rate_rules 表单没有编辑器，但编辑时原样带回去，免得被这次替换清成 null。
 */
function PlanFormDialog(props: {
  open: boolean;
  plan: Plan | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = createSignal("");
  const [mode, setMode] = createSignal<PlanMode>("pay_as_you_go");
  const [pricingMode, setPricingMode] = createSignal<PricingMode>("markup");
  const [markupMultiplier, setMarkupMultiplier] = createSignal("1");
  const [quotaKind, setQuotaKind] = createSignal<QuotaKind>("money");
  const [quotaAmount, setQuotaAmount] = createSignal("0");
  const [quotaPeriodDays, setQuotaPeriodDays] = createSignal("30");
  const [overageMode, setOverageMode] = createSignal<OverageMode>("disabled");
  const [price, setPrice] = createSignal("0");
  const [currency, setCurrency] = createSignal("CNY");
  const [features, setFeatures] = createSignal("");
  const [recommended, setRecommended] = createSignal(false);
  const [sortOrder, setSortOrder] = createSignal("0");
  const [rateRules, setRateRules] = createSignal<unknown>(undefined);
  const [notice, setNotice] = createSignal("");
  const [pending, setPending] = createSignal(false);

  const isEdit = () => props.plan !== null;

  createEffect(() => {
    if (!props.open) return;
    const plan = props.plan;
    setName(plan?.name ?? "");
    setMode((plan?.mode as PlanMode) ?? "pay_as_you_go");
    setPricingMode((plan?.pricing_mode as PricingMode) ?? "markup");
    setMarkupMultiplier(plan ? String(plan.markup_multiplier) : "1");
    setQuotaKind((plan?.quota_kind as QuotaKind) ?? "money");
    setQuotaAmount(plan ? String(plan.quota_amount) : "0");
    setQuotaPeriodDays(plan ? String(plan.quota_period_days) : "30");
    setOverageMode((plan?.overage_mode as OverageMode) ?? "disabled");
    setPrice(plan ? String(plan.price) : "0");
    setCurrency(plan?.currency ?? "CNY");
    setFeatures((plan?.features ?? []).join("\n"));
    setRecommended((plan?.recommended ?? 0) === 1);
    setSortOrder(plan ? String(plan.sort_order) : "0");
    setRateRules(plan?.rate_rules ?? undefined);
    setNotice("");
    setPending(false);
  });

  const submit = async () => {
    if (pending()) return;

    const built = buildPlanInput({
      name: name(),
      mode: mode(),
      pricingMode: pricingMode(),
      markupMultiplier: markupMultiplier(),
      quotaKind: quotaKind(),
      quotaAmount: quotaAmount(),
      quotaPeriodDays: quotaPeriodDays(),
      overageMode: overageMode(),
      price: price(),
      currency: currency(),
      features: features(),
      recommended: recommended(),
      sortOrder: sortOrder(),
      rateRules: rateRules(),
    });
    if (!built.ok) {
      setNotice(built.message);
      return;
    }

    setPending(true);
    setNotice("");
    try {
      if (props.plan) await updatePlan(props.plan.id, built.value);
      else await createPlan(built.value);
      props.onSaved();
      props.onOpenChange(false);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "保存失败");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={isEdit() ? "编辑套餐" : "新建套餐"}
      description={
        isEdit()
          ? "保存是整体替换：这份表单就是全部字段，留空的按默认值写回"
          : "新建后默认在售，模型价到「详情」里逐条加"
      }
      class="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto"
      footer={
        <>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={pending()} onClick={() => void submit()}>
            {pending() ? "保存中…" : isEdit() ? "保存修改" : "创建套餐"}
          </Button>
        </>
      }
    >
      <form
        class="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          void submit();
        }}
      >
        <div class="space-y-1.5">
          <Label for="plan-name">套餐名</Label>
          <Input
            id="plan-name"
            maxLength={64}
            value={name()}
            placeholder="例如：标准版月付"
            onInput={event => setName(event.currentTarget.value)}
          />
        </div>

        <div class="flex flex-wrap items-end gap-5">
          <div class="space-y-1.5">
            <Label>计费模式</Label>
            <Segmented
              options={MODE_OPTIONS}
              value={mode()}
              onChange={setMode}
              ariaLabel="计费模式"
            />
          </div>
          <div class="space-y-1.5">
            <Label>定价方式</Label>
            <Segmented
              options={PRICING_MODE_OPTIONS}
              value={pricingMode()}
              onChange={setPricingMode}
              ariaLabel="定价方式"
            />
          </div>
        </div>

        <Show
          when={pricingMode() === "markup"}
          fallback={
            <p class="text-xs text-muted-foreground">
              逐模型定价：套餐价格由「详情」里的模型价决定，下面填的成本倍率不会被使用。
            </p>
          }
        >
          <div class="space-y-1.5">
            <Label for="plan-markup">成本倍率</Label>
            <Input
              id="plan-markup"
              type="number"
              min="0"
              step="0.01"
              value={markupMultiplier()}
              onInput={event => setMarkupMultiplier(event.currentTarget.value)}
            />
            <p class="text-xs text-muted-foreground">按上游成本乘这个倍率，1 表示原价</p>
          </div>
        </Show>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="plan-price">周期价格</Label>
            <Input
              id="plan-price"
              type="number"
              min="0"
              step="0.01"
              value={price()}
              onInput={event => setPrice(event.currentTarget.value)}
            />
            <p class="text-xs text-muted-foreground">按量付费填 0</p>
          </div>
          <div class="space-y-1.5">
            <Label for="plan-currency">币种</Label>
            <Input
              id="plan-currency"
              maxLength={3}
              value={currency()}
              onInput={event => setCurrency(event.currentTarget.value)}
            />
            <p class="text-xs text-muted-foreground">3 个字母，例如 CNY</p>
          </div>
        </div>

        <Show when={mode() === "subscription"}>
          <div class="space-y-4 rounded-lg border p-4">
            <div class="space-y-1.5">
              <Label>订阅额度单位</Label>
              <Segmented
                options={QUOTA_KIND_OPTIONS}
                value={quotaKind()}
                onChange={setQuotaKind}
                ariaLabel="订阅额度单位"
              />
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <div class="space-y-1.5">
                <Label for="plan-quota-amount">每周期订阅额度</Label>
                <Input
                  id="plan-quota-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={quotaAmount()}
                  onInput={event => setQuotaAmount(event.currentTarget.value)}
                />
                <p class="text-xs text-muted-foreground">订阅套餐必须大于 0</p>
              </div>
              <div class="space-y-1.5">
                <Label for="plan-quota-days">周期天数</Label>
                <Input
                  id="plan-quota-days"
                  type="number"
                  min="1"
                  step="1"
                  value={quotaPeriodDays()}
                  onInput={event => setQuotaPeriodDays(event.currentTarget.value)}
                />
                <p class="text-xs text-muted-foreground">订阅套餐必须大于 0</p>
              </div>
            </div>

            <div class="space-y-1.5">
              <Label>超额处理</Label>
              <Segmented
                options={OVERAGE_MODE_OPTIONS}
                value={overageMode()}
                onChange={setOverageMode}
                ariaLabel="超额处理"
              />
            </div>
          </div>
        </Show>

        <div class="space-y-1.5">
          <Label for="plan-features">卖点</Label>
          <Textarea
            id="plan-features"
            rows={4}
            value={features()}
            placeholder={"一行一条，例如：\n每月 68 元订阅额度\n全量模型可用"}
            onInput={event => setFeatures(event.currentTarget.value)}
          />
        </div>

        <div class="flex flex-wrap items-end justify-between gap-4">
          <div class="space-y-1.5">
            <Label for="plan-sort">排列顺序</Label>
            <Input
              id="plan-sort"
              type="number"
              step="1"
              class="w-28"
              value={sortOrder()}
              onInput={event => setSortOrder(event.currentTarget.value)}
            />
            <p class="text-xs text-muted-foreground">越小越靠前</p>
          </div>

          <Switch
            checked={recommended()}
            onChange={setRecommended}
            label="在列表里标为推荐"
            class="pb-1"
          />
        </div>

        <Show when={notice()}>
          <p class="text-sm text-destructive-text" role="alert">
            {notice()}
          </p>
        </Show>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ 详情 */

/** 详情：套餐全字段加模型价增删。模型价只对逐模型定价的套餐有意义，但接口不拦 */
function PlanDetailDialog(props: {
  open: boolean;
  planId: number | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = createSignal<PlanDetail | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [notice, setNotice] = createSignal("");
  const [deletingId, setDeletingId] = createSignal<number | null>(null);
  /** 待确认删除的模型价。删了就没了，不能撤销 */
  const [pendingPrice, setPendingPrice] = createSignal<PlanPrice | null>(null);
  /** 加价撞 409 时把冲突的模型名记下来，上面那张表据此把那一行标出来 */
  const [duplicateModel, setDuplicateModel] = createSignal("");

  const load = async (id: number) => {
    setLoading(true);
    setNotice("");
    try {
      setDetail(await fetchPlanDetail(id));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    if (!props.open) return;
    const id = props.planId;
    setDetail(null);
    setNotice("");
    setDuplicateModel("");
    if (id !== null) void load(id);
  });

  const removePrice = async (price: PlanPrice) => {
    const id = props.planId;
    if (id === null || deletingId() !== null) return;
    setDeletingId(price.id);
    setNotice("");
    try {
      await deletePlanPrice(price.id);
      await load(id);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={detail()?.plan.name ?? "套餐详情"}
      description="模型价只对定价方式为「逐模型定价」的套餐生效"
      class="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto"
      footer={
        <Button variant="outline" onClick={() => props.onOpenChange(false)}>
          关闭
        </Button>
      }
    >
      <Show when={notice()}>
        <p class="mb-3 text-sm text-destructive-text" role="alert">
          {notice()}
        </p>
      </Show>

      <Show when={loading()}>
        <p class="py-6 text-center text-sm text-muted-foreground">正在加载…</p>
      </Show>

      <Show when={detail()}>
        {current => (
          <div class="space-y-5">
            <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <DetailRow
                label="计费模式"
                value={PLAN_MODE_LABELS[current().plan.mode] ?? current().plan.mode}
              />
              <DetailRow
                label="定价方式"
                value={PRICING_MODE_LABELS[current().plan.pricing_mode] ?? current().plan.pricing_mode}
              />
              <DetailRow
                label="周期价格"
                value={`${formatPlanMoney(current().plan.price, current().plan.currency)}${
                  current().plan.mode === "subscription"
                    ? ` / ${current().plan.quota_period_days} 天`
                    : ""
                }`}
              />
              <DetailRow
                label="成本倍率"
                value={current().plan.pricing_mode === "markup" ? String(current().plan.markup_multiplier) : "不使用"}
              />
              <DetailRow
                label="本周期订阅额度"
                value={
                  current().plan.mode === "subscription"
                    ? `${current().plan.quota_amount} ${
                        QUOTA_KIND_LABELS[current().plan.quota_kind] ?? current().plan.quota_kind
                      } / ${current().plan.quota_period_days} 天`
                    : "无订阅额度，按量扣减"
                }
              />
              <DetailRow
                label="超额处理"
                value={
                  current().plan.mode === "subscription"
                    ? (OVERAGE_MODE_LABELS[current().plan.overage_mode] ?? current().plan.overage_mode)
                    : "-"
                }
              />
              <DetailRow label="排列顺序" value={String(current().plan.sort_order)} />
              <DetailRow
                label="状态"
                value={current().plan.status === 1 ? "在售" : "已停用"}
              />
            </dl>

            <Show when={current().plan.features.length > 0}>
              <div>
                <h3 class="text-sm font-semibold">卖点</h3>
                <ul class="mt-2 space-y-1.5 text-sm">
                  <For each={current().plan.features}>
                    {feature => (
                      <li class="flex items-start gap-2">
                        <CircleCheck class="mt-0.5 size-4 shrink-0 text-success-text" />
                        <span class="text-muted-foreground">{feature}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>

            <div>
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold">模型价</h3>
                <span class="text-xs text-muted-foreground">
                  共 {formatNumber(current().prices.length)} 条
                </span>
              </div>

              <Show
                when={current().prices.length > 0}
                fallback={
                  <p class="mt-2 text-sm text-muted-foreground">还没有模型价。</p>
                }
              >
                <div class="mt-2 rounded-lg border">
                  <Table tableClass="min-w-[900px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>模型</TableHead>
                        <TableHead>计费</TableHead>
                        <TableHead class="text-right">输入 / 百万</TableHead>
                        <TableHead class="text-right">输出 / 百万</TableHead>
                        <TableHead class="text-right">缓存读</TableHead>
                        <TableHead class="text-right">缓存写</TableHead>
                        <TableHead class="text-right">每次</TableHead>
                        <TableHead class="text-right">权重</TableHead>
                        <TableHead class="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <For each={current().prices}>
                        {price => (
                          <TableRow class={duplicateModel() === price.model ? "bg-warning/10" : undefined}>
                            <TableCell class="font-medium">{price.model}</TableCell>
                            <TableCell class="text-muted-foreground">
                              {COST_MODE_LABELS[price.cost_mode] ?? price.cost_mode}
                            </TableCell>
                            <TableCell class="text-right tabular-nums">
                              {formatPlanMoney(price.input_per_million, current().plan.currency)}
                            </TableCell>
                            <TableCell class="text-right tabular-nums">
                              {formatPlanMoney(price.output_per_million, current().plan.currency)}
                            </TableCell>
                            <TableCell class="text-right tabular-nums">
                              {formatPlanMoney(price.cache_read_per_million, current().plan.currency)}
                            </TableCell>
                            <TableCell class="text-right tabular-nums">
                              {formatPlanMoney(price.cache_write_per_million, current().plan.currency)}
                            </TableCell>
                            <TableCell class="text-right tabular-nums">
                              {formatPlanMoney(price.per_request, current().plan.currency)}
                            </TableCell>
                            <TableCell class="text-right tabular-nums">
                              {formatNumber(price.request_weight, 2)}
                            </TableCell>
                            <TableCell class="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                class="text-destructive-text"
                                disabled={deletingId() === price.id}
                                aria-label={`删除 ${price.model} 的定价`}
                                onClick={() => setPendingPrice(price)}
                              >
                                <Trash class="size-3.5" aria-hidden="true" />
                                删除
                              </Button>
                            </TableCell>
                          </TableRow>
                        )}
                      </For>
                    </TableBody>
                  </Table>
                </div>
              </Show>

              <Show
                when={current().plan.status === 1}
                fallback={
                  <p class="mt-3 text-xs text-muted-foreground">
                    套餐已停用，接口不再接受新的模型价。
                  </p>
                }
              >
                <AddPriceForm
                  planId={current().plan.id}
                  currency={current().plan.currency}
                  onDuplicate={setDuplicateModel}
                  onAdded={() => {
                    setDuplicateModel("");
                    const id = props.planId;
                    if (id !== null) void load(id);
                  }}
                />
              </Show>
            </div>
          </div>
        )}
      </Show>
      </Dialog>

      {/* 删模型价不可撤销，删完这个模型就没有定价了，先确认一次 */}
      <Dialog
        open={pendingPrice() !== null}
        onOpenChange={open => {
          if (!open) setPendingPrice(null);
        }}
        title="删掉这条模型价？"
        description={`删掉「${pendingPrice()?.model ?? ""}」在「${detail()?.plan.name ?? "这个套餐"}」下的定价之后，这个模型在这个套餐里就没有价了，不能撤销。已经按它结算过的账单不受影响。`}
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingPrice(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deletingId() === pendingPrice()?.id}
              onClick={() => {
                const price = pendingPrice();
                if (!price) return;
                setPendingPrice(null);
                void removePrice(price);
              }}
            >
              确认删除
            </Button>
          </>
        }
      />
    </>
  );
}

/** 详情里的「加模型价」表单。金额字段只认数字，取值与校验交给 buildPriceInput */
function AddPriceForm(props: {
  planId: number;
  currency: string;
  /** 该模型已有价时递出它的 id，让调用方能把那一行标出来 */
  onDuplicate: (model: string) => void;
  onAdded: () => void;
}) {
  const [model, setModel] = createSignal("");
  const [costMode, setCostMode] = createSignal<PlanCostMode>("token");
  const [inputPerMillion, setInputPerMillion] = createSignal("");
  const [outputPerMillion, setOutputPerMillion] = createSignal("");
  const [cacheReadPerMillion, setCacheReadPerMillion] = createSignal("");
  const [cacheWritePerMillion, setCacheWritePerMillion] = createSignal("");
  const [perRequest, setPerRequest] = createSignal("");
  const [requestWeight, setRequestWeight] = createSignal("1");
  const [notice, setNotice] = createSignal("");
  const [pending, setPending] = createSignal(false);

  const submit = async () => {
    if (pending()) return;

    const built = buildPriceInput({
      model: model(),
      costMode: costMode(),
      inputPerMillion: inputPerMillion(),
      outputPerMillion: outputPerMillion(),
      cacheReadPerMillion: cacheReadPerMillion(),
      cacheWritePerMillion: cacheWritePerMillion(),
      perRequest: perRequest(),
      requestWeight: requestWeight(),
    });
    if (!built.ok) {
      setNotice(built.message);
      return;
    }

    setPending(true);
    setNotice("");
    try {
      await createPlanPrice(props.planId, built.value);
      setModel("");
      setInputPerMillion("");
      setOutputPerMillion("");
      setCacheReadPerMillion("");
      setCacheWritePerMillion("");
      setPerRequest("");
      setRequestWeight("1");
      props.onAdded();
    } catch (err) {
      const message = err instanceof Error ? err.message : "添加失败";
      // 409 说「该模型已有定价」时，光把这句话摆在表单里没用 —— 得让人知道
      // 要去删哪一行。除了说明怎么走，还把模型名交回去，上面那张表会标出冲突行。
      if (message.includes("已有定价")) {
        setNotice(`${message}：先在上面那张表里删掉「${model().trim()}」那一行，再加新的`);
        props.onDuplicate(model().trim());
      } else {
        setNotice(message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      class="mt-3 space-y-3 rounded-lg border bg-muted/30 p-4"
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      <p class="text-sm font-medium">加一条模型价</p>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="space-y-1.5">
          <Label for="price-model">模型</Label>
          <Input
            id="price-model"
            maxLength={128}
            value={model()}
            placeholder="例如：gpt-4o"
            onInput={event => setModel(event.currentTarget.value)}
          />
        </div>
        <Select
          label="计费方式"
          class="w-full"
          portal={false}
          options={COST_MODE_OPTIONS}
          value={costMode()}
          onChange={value => setCostMode(value as PlanCostMode)}
        />
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <MoneyField
          id="price-input"
          label={`输入单价（${props.currency} / 百万 Token）`}
          value={inputPerMillion()}
          onInput={setInputPerMillion}
        />
        <MoneyField
          id="price-output"
          label={`输出单价（${props.currency} / 百万 Token）`}
          value={outputPerMillion()}
          onInput={setOutputPerMillion}
        />
        <MoneyField
          id="price-per-request"
          label={`每次调用（${props.currency}）`}
          value={perRequest()}
          onInput={setPerRequest}
        />
        <MoneyField
          id="price-cache-read"
          label={`缓存读（${props.currency} / 百万）`}
          value={cacheReadPerMillion()}
          onInput={setCacheReadPerMillion}
        />
        <MoneyField
          id="price-cache-write"
          label={`缓存写（${props.currency} / 百万）`}
          value={cacheWritePerMillion()}
          onInput={setCacheWritePerMillion}
        />
        <MoneyField
          id="price-weight"
          label="请求权重"
          value={requestWeight()}
          onInput={setRequestWeight}
        />
      </div>

      <Show when={notice()}>
        <p class="text-sm text-destructive-text" role="alert">
          {notice()}
        </p>
      </Show>

      <div class="flex justify-end">
        <Button type="submit" size="sm" disabled={pending()}>
          {pending() ? "添加中…" : "添加"}
        </Button>
      </div>
    </form>
  );
}

function MoneyField(props: {
  id: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
}) {
  return (
    <div class="space-y-1.5">
      <Label for={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        type="number"
        min="0"
        step="0.01"
        placeholder="0"
        value={props.value}
        onInput={event => props.onInput(event.currentTarget.value)}
      />
    </div>
  );
}

/* ------------------------------------------------------------ 续费历史 */

function ActivationHistoryDialog(props: {
  open: boolean;
  target: PlanActivation | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [page, setPage] = createSignal(1);
  const [data, setData] = createSignal<{ items: PlanActivationHistoryItem[]; total: number }>({
    items: [],
    total: 0,
  });
  const [loading, setLoading] = createSignal(false);
  const [notice, setNotice] = createSignal("");

  const load = async (userId: number, targetPage: number) => {
    setLoading(true);
    setNotice("");
    try {
      setData(await fetchPlanActivationHistory(userId, { page: targetPage, size: 20 }));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    if (!props.open) return;
    const target = props.target;
    setPage(1);
    setData({ items: [], total: 0 });
    setNotice("");
    if (target) void load(target.user_id, 1);
  });

  const changePage = (targetPage: number) => {
    setPage(targetPage);
    const target = props.target;
    if (target) void load(target.user_id, targetPage);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.target ? `${props.target.user_name} 的续费历史` : "续费历史"}
      description="数据源是账本里 source=subscription 的扣款记录，金额已翻成正数"
      class="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto"
      footer={
        <Button variant="outline" onClick={() => props.onOpenChange(false)}>
          关闭
        </Button>
      }
    >
      <Show when={notice()}>
        <p class="mb-3 text-sm text-destructive-text" role="alert">
          {notice()}
        </p>
      </Show>

      <Show
        when={data().items.length > 0}
        fallback={
          <p class="py-6 text-center text-sm text-muted-foreground">
            {loading() ? "正在加载…" : "没有续费记录"}
          </p>
        }
      >
        <div class="rounded-lg border">
          <Table tableClass="min-w-[480px]">
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>套餐</TableHead>
                <TableHead class="text-right">金额</TableHead>
                <TableHead class="text-right">扣后余额</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <For each={data().items}>
                {item => (
                  <TableRow>
                    <TableCell class="tabular-nums text-muted-foreground">
                      {formatDate(item.created_at)}
                    </TableCell>
                    <TableCell>
                      <p>{item.plan_name || "（套餐已删除）"}</p>
                      <Show when={item.ref_id}>
                        <p class="mt-0.5 text-xs text-muted-foreground">{item.ref_id}</p>
                      </Show>
                    </TableCell>
                    <TableCell class="text-right tabular-nums">{formatYuan(item.amount)}</TableCell>
                    <TableCell class="text-right tabular-nums text-muted-foreground">
                      {formatYuan(item.balance_after)}
                    </TableCell>
                  </TableRow>
                )}
              </For>
            </TableBody>
          </Table>
        </div>
      </Show>

      <PagerIfNeeded
        page={page()}
        size={20}
        total={data().total}
        onPageChange={changePage}
      />
    </Dialog>
  );
}
