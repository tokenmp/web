import { Title } from "@solidjs/meta";
import Plus from "lucide-solid/icons/plus";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

import { PageHeader, StatRow } from "~/components/layout/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Dialog } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { PagerIfNeeded } from "~/components/ui/pager";
import { Segmented } from "~/components/ui/segmented";
import { Select } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Toolbar, ToolbarSearch, ToolbarSpacer } from "~/components/ui/toolbar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  applyAdjustment,
  BATCH_LIMIT,
  batchRecharge,
  BatchRechargeError,
  fetchAdjustLogs,
  fetchAllBalanceAccounts,
  fetchBalanceAccounts,
  setUserBudget,
  updateCreditLimit,
  type AdjustDirection,
  type AdjustLogItem,
  type BalanceAccount,
  type BatchRechargeResult,
  type BudgetPeriod,
  type UserBudget,
} from "~/lib/admin-balances";
import { createClientResource } from "~/lib/resource";
import { BUDGET_PERIOD_LABEL, formatCurrency, formatDateTime, formatNumber } from "~/lib/utils";

type AccountAction = "recharge" | "adjust" | "credit" | "budget";

const ACTION_TITLES: Record<AccountAction, string> = {
  recharge: "给该用户代充",
  adjust: "手工调账",
  credit: "修改授信额度",
  budget: "设置预算封顶",
};

const PERIOD_OPTIONS: { value: BudgetPeriod; label: string }[] = [
  { value: "day", label: "每日" },
  { value: "week", label: "每周" },
  { value: "month", label: "每月" },
];

/** 状态标签：停用优先，其次是透支到授信的欠费 */
function accountStatus(account: BalanceAccount) {
  if (account.status === 0) return { label: "已停用", variant: "warning" as const };
  if (account.balance < 0) return { label: "欠费", variant: "destructive" as const };
  return { label: "正常", variant: "secondary" as const };
}

/** 已启用的预算显示成一行，没设或金额为 0 都当没设 */
function budgetText(budget: UserBudget) {
  if (budget.enabled !== 1 || budget.amount <= 0) return null;
  return `${BUDGET_PERIOD_LABEL[budget.period] ?? budget.period} ${formatCurrency(budget.amount)}`;
}

/** 带符号的金额，入账正、扣款负 */
function signedCurrency(value: number) {
  const abs = formatCurrency(Math.abs(value));
  return value >= 0 ? `+${abs}` : `-${abs}`;
}

/** ref_id 前缀区分来源：rc- 是代充，adj- 是手工调账 */
function sourceLabel(refId: string) {
  return refId.startsWith("rc-") ? "代充" : "调账";
}

/** datetime-local 的值转 ISO；空值或非法值返回 undefined，交给后端忽略 */
function toIso(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * 余额账本。
 *
 * 分「账户与余额」「调账记录」两页：前者选人做代充、调账、改授信、设预算，
 * 后者按用户、操作人、方向、流水号与时间查手工调账的痕迹。
 *
 * 金额一律以服务端返回的 balance_after 为准，前端不自己算余额；
 * 这里出现的合计只是把接口返回的字段加起来给个概览，不参与记账。
 */
export default function DashboardBalances() {
  const [tab, setTab] = createSignal<"accounts" | "logs">("accounts");

  /* ------------------------------------------------------------ 账户页 */

  const [page, setPage] = createSignal(1);
  const [size, setSize] = createSignal(20);
  const [keyword, setKeyword] = createSignal("");

  const accounts = createClientResource<{ items: BalanceAccount[]; total: number }>(
    () =>
      fetchBalanceAccounts({
        page: page(),
        size: size(),
        keyword: keyword().trim() || undefined,
      }),
    { items: [], total: 0 },
  );

  // 搜索是服务端做的，输入即查会把每个字符都变成一次请求，等手停下来再发。
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const onSearchInput = (value: string) => {
    setKeyword(value);
    setPage(1);
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void accounts.reload(), 300);
  };

  const [action, setAction] = createSignal<AccountAction | null>(null);
  const [activeAccount, setActiveAccount] = createSignal<BalanceAccount | null>(null);
  const [batchOpen, setBatchOpen] = createSignal(false);

  const openAction = (account: BalanceAccount, next: AccountAction) => {
    setActiveAccount(account);
    setAction(next);
  };

  const targets = createMemo(() =>
    accounts.data().items.map(account => ({ id: account.id, name: account.name })),
  );

  const stats = createMemo(() => {
    const items = accounts.data().items;
    const budgeted = items.filter(
      account => account.budget.enabled === 1 && account.budget.amount > 0,
    ).length;
    return [
      {
        label: "匹配账户",
        value: formatNumber(accounts.data().total),
        hint: "按用户名模糊匹配",
      },
      {
        label: "本页可用余额",
        value: formatCurrency(items.reduce((sum, account) => sum + account.balance, 0)),
        hint: `当前页 ${items.length} 个账户合计`,
      },
      {
        label: "本页授信额度",
        value: formatCurrency(items.reduce((sum, account) => sum + account.credit_limit, 0)),
        hint: "余额扣成负数时由授信承接",
      },
      {
        label: "本页已设预算",
        value: formatNumber(budgeted),
        hint: "启用且金额大于 0 的账户",
      },
    ];
  });

  return (
    <>
      <Title>余额 | TokenMP 销售控制台</Title>

      <PageHeader>
        <Show when={tab() === "accounts"}>
          <Button onClick={() => setBatchOpen(true)} disabled={accounts.data().items.length === 0}>
            <Plus class="size-4" aria-hidden="true" />
            批量充值
          </Button>
        </Show>
      </PageHeader>

      <div class="mb-4">
        <Segmented
          options={[
            { value: "accounts", label: "账户与余额" },
            { value: "logs", label: "调账记录" },
          ]}
          value={tab()}
          onChange={setTab}
          ariaLabel="切换余额账本视图"
        />
      </div>

      <Show when={tab() === "accounts"}>
        <StatRow items={stats()} />

        <Card class="overflow-hidden">
          <Toolbar>
            <ToolbarSearch
              placeholder="搜索用户名"
              ariaLabel="搜索用户"
              value={keyword()}
              onInput={onSearchInput}
              class="sm:max-w-xs"
            />
            <ToolbarSpacer />
            <p class="text-sm text-muted-foreground">
              代充是 source=recharge 的入账，调账可正可负，两者都允许透支
            </p>
          </Toolbar>

          <Show when={accounts.error()}>
            <div class="border-b px-4 py-6 text-center text-sm">
              <p class="text-muted-foreground">{accounts.error()}</p>
              <Button
                variant="outline"
                size="sm"
                class="mt-3"
                onClick={() => void accounts.reload()}
              >
                重新加载
              </Button>
            </div>
          </Show>

          <Table class="border-b" tableClass="min-w-[960px]">
            <TableHeader>
              <TableRow>
                <TableHead>用户</TableHead>
                <TableHead class="text-right">可用余额</TableHead>
                <TableHead class="text-right">授信额度</TableHead>
                <TableHead>预算</TableHead>
                <TableHead>套餐</TableHead>
                <TableHead class="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <For each={accounts.data().items}>
                {account => {
                  const status = accountStatus(account);
                  const budget = () => budgetText(account.budget);
                  return (
                    <TableRow>
                      <TableCell>
                        <div class="flex flex-col gap-1">
                          <span class="flex items-center gap-2">
                            <span class="font-medium">{account.name}</span>
                            <Badge variant={status.variant}>{status.label}</Badge>
                            <Show when={account.role === "admin"}>
                              <Badge variant="outline">管理员</Badge>
                            </Show>
                          </span>
                          <span class="text-xs text-muted-foreground">
                            {account.email ?? "未填邮箱"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell
                        class="text-right font-medium tabular-nums"
                        classList={{ "text-destructive-text": account.balance < 0 }}
                      >
                        {formatCurrency(account.balance)}
                      </TableCell>
                      <TableCell class="text-right tabular-nums text-muted-foreground">
                        {formatCurrency(account.credit_limit)}
                      </TableCell>
                      <TableCell class="tabular-nums">
                        <Show
                          when={budget()}
                          fallback={<span class="text-muted-foreground">未设置</span>}
                        >
                          <span>
                            {budget()}
                            <span class="ml-1 text-xs text-muted-foreground">
                              已用 {formatCurrency(account.budget.used)}
                            </span>
                          </span>
                        </Show>
                      </TableCell>
                      <TableCell class="text-muted-foreground">
                        {account.subscription ? `套餐 #${account.subscription.plan_id}` : "无"}
                      </TableCell>
                      <TableCell>
                        <div class="flex flex-wrap items-center justify-end gap-1.5">
                          <Button
                            variant="default"
                            size="sm"
                            aria-label={`给 ${account.name} 代充`}
                            onClick={() => openAction(account, "recharge")}
                          >
                            代充
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`给 ${account.name} 调账`}
                            onClick={() => openAction(account, "adjust")}
                          >
                            调账
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`修改 ${account.name} 的授信额度`}
                            onClick={() => openAction(account, "credit")}
                          >
                            授信
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`设置 ${account.name} 的预算`}
                            onClick={() => openAction(account, "budget")}
                          >
                            预算
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                }}
              </For>

              <Show when={accounts.data().items.length === 0}>
                <TableRow>
                  <TableCell class="py-10 text-center text-muted-foreground" colSpan={6}>
                    {accounts.loading() ? "正在加载…" : "没有匹配的账户，换个关键词试试"}
                  </TableCell>
                </TableRow>
              </Show>
            </TableBody>
          </Table>

          <PagerIfNeeded
            page={page()}
            size={size()}
            total={accounts.data().total}
            onPageChange={next => {
              setPage(next);
              void accounts.reload();
            }}
            onSizeChange={next => {
              setSize(next);
              setPage(1);
              void accounts.reload();
            }}
          />
        </Card>
      </Show>

      <Show when={tab() === "logs"}>
        <AdjustLogsPanel />
      </Show>

      <BalanceActionDialog
        open={action() !== null}
        action={action()}
        account={activeAccount()}
        onOpenChange={open => {
          if (!open) setAction(null);
        }}
        onSaved={() => void accounts.reload()}
      />

      <BatchRechargeDialog
        open={batchOpen()}
        targets={targets()}
        total={accounts.data().total}
        keyword={keyword().trim() || undefined}
        onOpenChange={setBatchOpen}
        onSaved={() => void accounts.reload()}
      />
    </>
  );
}

/**
 * 一个弹窗管四件事：代充、调账、改授信、设预算。
 * 拆成四个弹窗会让每行都要挂四个常驻组件，这里按 action 切换表单内容。
 */
function BalanceActionDialog(props: {
  open: boolean;
  action: AccountAction | null;
  account: BalanceAccount | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = createSignal("");
  const [reason, setReason] = createSignal("");
  const [creditLimit, setCreditLimit] = createSignal("");
  const [budgetEnabled, setBudgetEnabled] = createSignal(true);
  const [budgetAmount, setBudgetAmount] = createSignal("");
  const [budgetPeriod, setBudgetPeriod] = createSignal<BudgetPeriod>("month");
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const [result, setResult] = createSignal("");

  // 每次打开都按当前账户重置表单：弹窗常驻，不重置会残留上一次的值
  createEffect(() => {
    if (!props.open) return;
    const account = props.account;
    setAmount("");
    setReason(props.action === "recharge" ? "代充" : "手工调账");
    setCreditLimit(account ? String(account.credit_limit) : "0");
    setBudgetEnabled(account ? account.budget.enabled === 1 : false);
    setBudgetAmount(
      account && account.budget.amount > 0 ? String(account.budget.amount) : "",
    );
    setBudgetPeriod((account?.budget?.period as BudgetPeriod) ?? "month");
    setPending(false);
    setError("");
    setResult("");
  });

  const description = () => {
    const account = props.account;
    if (!account) return "";
    const who = account.email ? `${account.name} · ${account.email}` : account.name;
    switch (props.action) {
      case "recharge":
        return `为 ${who} 增加可用余额`;
      case "adjust":
        return `调整 ${who} 的余额，正数入账、负数扣款`;
      case "credit":
        return `当前授信 ${formatCurrency(account.credit_limit)}，这是最多能欠多少`;
      case "budget":
        return `当前余额 ${formatCurrency(account.balance)}，预算按周期封顶用量`;
      default:
        return "";
    }
  };

  const submit = async () => {
    if (pending()) return;
    const account = props.account;
    const next = props.action;
    if (!account || !next) return;

    setError("");
    setPending(true);
    try {
      if (next === "recharge" || next === "adjust") {
        const value = Number(amount());
        if (!Number.isFinite(value) || value === 0) {
          setError("金额必须是非零数字");
          return;
        }
        if (next === "recharge" && value < 0) {
          setError("代充金额要填正数，扣款请用调账");
          return;
        }
        const trimmed = reason().trim();
        if (!trimmed) {
          setError("请填写事由");
          return;
        }

        const res = await applyAdjustment({
          userId: account.id,
          amount: value,
          reason: trimmed,
          source: next === "recharge" ? "recharge" : "adjust",
        });
        setResult(
          `已提交，${account.name} 的变动后余额为 ${formatCurrency(res.balance_after)}（流水号 ${res.ref}）`,
        );
      } else if (next === "credit") {
        const value = Number(creditLimit());
        if (!Number.isFinite(value) || value < 0) {
          setError("授信额度要是不小于 0 的数字");
          return;
        }
        await updateCreditLimit(account.id, value);
        setResult(`已把 ${account.name} 的授信额度改为 ${formatCurrency(value)}`);
      } else {
        const value = budgetEnabled() ? Number(budgetAmount()) : 0;
        if (!Number.isFinite(value) || value < 0) {
          setError("预算金额要是不小于 0 的数字");
          return;
        }
        const saved = await setUserBudget(account.id, {
          enabled: budgetEnabled() && value > 0,
          amount: value,
          period: budgetPeriod(),
        });
        setResult(
          saved.enabled === 1 && saved.amount > 0
            ? `已设为${BUDGET_PERIOD_LABEL[saved.period] ?? saved.period} ${formatCurrency(saved.amount)}`
            : `已清除 ${account.name} 的预算`,
        );
      }
      props.onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.action ? ACTION_TITLES[props.action] : "余额操作"}
      description={description()}
      footer={
        <Show
          when={!result()}
          fallback={
            <Button onClick={() => props.onOpenChange(false)}>完成</Button>
          }
        >
          <Button
            variant="outline"
            disabled={pending()}
            onClick={() => props.onOpenChange(false)}
          >
            取消
          </Button>
          <Button disabled={pending()} onClick={() => void submit()}>
            {pending() ? "提交中…" : "确认"}
          </Button>
        </Show>
      }
    >
      <Show when={result()}>
        <p class="rounded-md bg-success/15 px-3 py-2 text-success-text" role="status">
          {result()}
        </p>
      </Show>

      <Show when={!result()}>
        <Show when={props.action === "recharge" || props.action === "adjust"}>
          <div class="space-y-1.5">
            <Label for="balance-amount">
              {props.action === "recharge" ? "充值金额（美元）" : "调账金额（美元）"}
            </Label>
            <Input
              id="balance-amount"
              type="number"
              step="0.01"
              placeholder={props.action === "recharge" ? "0.00" : "正数入账，负数扣款"}
              value={amount()}
              onInput={event => setAmount(event.currentTarget.value)}
            />
            <p class="text-muted-foreground">
              {props.action === "recharge"
                ? "代充按入账处理，会先冲抵已经用掉的授信。"
                : "正数入账会先冲抵已用授信；负数扣款先扣余额，余额不足时占用授信，允许透支。"}
            </p>
          </div>
          <div class="mt-3 space-y-2">
            <Label for="balance-reason">事由</Label>
            <Input
              id="balance-reason"
              maxlength={256}
              value={reason()}
              onInput={event => setReason(event.currentTarget.value)}
            />
          </div>
        </Show>

        <Show when={props.action === "credit"}>
          <div class="space-y-1.5">
            <Label for="balance-credit">新的授信额度（美元）</Label>
            <Input
              id="balance-credit"
              type="number"
              min="0"
              step="0.01"
              value={creditLimit()}
              onInput={event => setCreditLimit(event.currentTarget.value)}
            />
            <p class="text-muted-foreground">
              授信是「最多能欠多少」，填 0 表示不能透支，余额扣到 0 就停。
            </p>
          </div>
        </Show>

        <Show when={props.action === "budget"}>
          <div class="space-y-3">
            <Switch
              checked={budgetEnabled()}
              onChange={setBudgetEnabled}
              label="启用预算封顶"
            />
            <div class="space-y-1.5">
              <Label for="balance-budget">预算金额（美元）</Label>
              <Input
                id="balance-budget"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                disabled={!budgetEnabled()}
                value={budgetAmount()}
                onInput={event => setBudgetAmount(event.currentTarget.value)}
              />
            </div>
            <Select
              label="周期"
              options={PERIOD_OPTIONS.map(option => ({
                value: option.value,
                label: option.label,
              }))}
              value={budgetPeriod()}
              onChange={value => setBudgetPeriod(value as BudgetPeriod)}
              disabled={!budgetEnabled()}
              portal={false}
            />
            <p class="text-muted-foreground">
              关掉开关或金额填 0 都会清除预算。
            </p>
          </div>
        </Show>
      </Show>

      <Show when={error()}>
        <p class="mt-3 text-destructive-text" role="alert">
          {error()}
        </p>
      </Show>
    </Dialog>
  );
}

/**
 * 批量充值：在一个事务里对整批账户各充值同一笔金额。
 *
 * 范围可选「当前页」或「全部筛选结果」。后者先按当前关键词翻页取完 id；超过单批
 * 200 条上限时拆成多批依次提交，并在弹窗里说明批与批之间不是原子的。失败直接把后端
 * 返回的原因显示出来（含是第几条）。
 */
function BatchRechargeDialog(props: {
  open: boolean;
  targets: { id: number; name: string }[];
  total: number;
  keyword?: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [scope, setScope] = createSignal<"page" | "all">("page");
  const [amount, setAmount] = createSignal("");
  const [reason, setReason] = createSignal("批量充值");
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const [summary, setSummary] = createSignal<BatchRechargeResult | null>(null);

  createEffect(() => {
    if (!props.open) return;
    setScope("page");
    setAmount("");
    setReason("批量充值");
    setPending(false);
    setError("");
    setSummary(null);
  });

  // 计划处理的账户数：当前页立刻知道，全部筛选结果用列表接口给的 total
  const plannedCount = () => (scope() === "all" ? props.total : props.targets.length);
  const batchCount = () => Math.max(1, Math.ceil(plannedCount() / BATCH_LIMIT));

  const submit = async () => {
    if (pending()) return;
    const value = Number(amount());
    if (!Number.isFinite(value) || value <= 0) {
      setError("批量充值金额要是大于 0 的数字");
      return;
    }
    const trimmed = reason().trim();
    if (!trimmed) {
      setError("请填写事由");
      return;
    }

    setPending(true);
    setError("");
    try {
      let list = props.targets;
      if (scope() === "all") {
        list = await fetchAllBalanceAccounts({ keyword: props.keyword });
        if (list.length === 0) {
          setError("当前筛选下没有账户");
          return;
        }
      }
      const result = await batchRecharge(list, value, trimmed);
      setSummary(result);
      props.onSaved();
    } catch (err) {
      // 分批提交时前面的批已经落库，要把这件事说清楚
      if (err instanceof BatchRechargeError && err.applied > 0) {
        setError(`${err.message}；前 ${err.applied} 批已入账，无法回滚`);
      } else {
        setError(err instanceof Error ? err.message : "提交失败");
      }
    } finally {
      setPending(false);
    }
  };

  const result = () => summary();

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="批量充值"
      description="对选定的账户各充值同一笔金额，整批在同一个事务里提交"
      footer={
        <Show
          when={result()}
          fallback={
            <>
              <Button
                variant="outline"
                disabled={pending()}
                onClick={() => props.onOpenChange(false)}
              >
                取消
              </Button>
              <Button disabled={pending() || plannedCount() === 0} onClick={() => void submit()}>
                {pending()
                  ? `提交中…（共 ${plannedCount()} 笔）`
                  : `确认充值（${plannedCount()} 笔）`}
              </Button>
            </>
          }
        >
          <Button onClick={() => props.onOpenChange(false)}>完成</Button>
        </Show>
      }
    >
      <Show when={!result()}>
        <div class="space-y-1.5">
          <span class="text-sm font-medium">充值范围</span>
          <Segmented
            options={[
              { value: "page", label: `当前页（${props.targets.length}）` },
              { value: "all", label: `全部筛选结果（${props.total}）` },
            ]}
            value={scope()}
            onChange={setScope}
            ariaLabel="选择批量充值的账户范围"
          />
          <Show when={scope() === "all" && batchCount() > 1}>
            <p class="rounded-md bg-warning/15 px-3 py-2 text-warning-text" role="status">
              共 {props.total} 个账户，超过单批 {BATCH_LIMIT} 条上限，将分成 {batchCount()} 批
              依次提交。每批各自是一个事务，中途失败时已提交的批次不会回滚。
            </p>
          </Show>
        </div>
        <div class="mt-3 space-y-2">
          <Label for="batch-amount">每笔金额（美元）</Label>
          <Input
            id="batch-amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amount()}
            onInput={event => setAmount(event.currentTarget.value)}
          />
          <p class="text-muted-foreground">
            整批在同一个事务里提交，全成或全滚。
          </p>
        </div>
        <div class="mt-3 space-y-2">
          <Label for="batch-reason">事由</Label>
          <Input
            id="batch-reason"
            maxlength={256}
            value={reason()}
            onInput={event => setReason(event.currentTarget.value)}
          />
        </div>
        <div class="mt-3 rounded-md border p-3">
          <p class="text-muted-foreground">
            {scope() === "all" ? `全部筛选结果共 ${props.total} 个账户：` : "将充值到："}
          </p>
          <Show
            when={scope() === "page"}
            fallback={
              <p class="mt-1 text-xs text-muted-foreground">
                提交时按当前关键词翻页取全部账户。
              </p>
            }
          >
            <ul class="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-xs">
              <For each={props.targets}>{target => <li>{target.name}</li>}</For>
            </ul>
          </Show>
        </div>
      </Show>

      <Show when={result()}>
        {summaryResult => (
          <p class="rounded-md bg-success/15 px-3 py-2 text-success-text" role="status">
            已为 {summaryResult().succeeded} 个账户各充值，共入账{" "}
            {formatCurrency(summaryResult().totalAmount)}。
            <Show when={summaryResult().batches > 1}>
              <span>（分 {summaryResult().batches} 批提交）</span>
            </Show>
            <Show when={summaryResult().lastBalanceAfter !== null}>
              <span>
                {" "}
                最后一笔后余额 {formatCurrency(summaryResult().lastBalanceAfter ?? 0)}。
              </span>
            </Show>
          </p>
        )}
      </Show>

      <Show when={error()}>
        <p class="mt-3 text-destructive-text" role="alert">
          {error()}
        </p>
      </Show>
    </Dialog>
  );
}

/**
 * 调账记录。只含手工调账与代充两类 —— 用量扣费、订阅扣款、分享返额都不在这里，
 * 需要看全部流水去用户面板。筛选在服务端做，start/end 传非法值后端会静默忽略。
 */
function AdjustLogsPanel() {
  const [page, setPage] = createSignal(1);
  const [size, setSize] = createSignal(20);

  // 输入控件绑定的即时值
  const [operator, setOperator] = createSignal("");
  const [userId, setUserId] = createSignal("");
  const [ref, setRef] = createSignal("");
  const [direction, setDirection] = createSignal<"all" | AdjustDirection>("all");
  const [start, setStart] = createSignal("");
  const [end, setEnd] = createSignal("");

  const logs = createClientResource<{ items: AdjustLogItem[]; total: number }>(
    () =>
      fetchAdjustLogs({
        page: page(),
        size: size(),
        user_id: userId().trim() || undefined,
        operator: operator().trim() || undefined,
        direction: direction() === "all" ? undefined : direction(),
        ref: ref().trim() || undefined,
        start: toIso(start()),
        end: toIso(end()),
      }),
    { items: [], total: 0 },
  );

  const search = () => {
    setPage(1);
    void logs.reload();
  };

  const reset = () => {
    setOperator("");
    setUserId("");
    setRef("");
    setDirection("all");
    setStart("");
    setEnd("");
    setPage(1);
    void logs.reload();
  };

  return (
    <Card class="overflow-hidden">
      <div class="space-y-3 border-b px-4 py-3">
        <p class="text-sm text-muted-foreground">
          只含手工调账与代充；用量扣费、订阅扣款、分享返额记在用户流水里。
        </p>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div class="space-y-1.5">
            <Label for="log-operator">操作人</Label>
            <Input
              id="log-operator"
              placeholder="模糊匹配"
              value={operator()}
              onInput={event => setOperator(event.currentTarget.value)}
            />
          </div>
          <div class="space-y-1.5">
            <Label for="log-user">用户 ID</Label>
            <Input
              id="log-user"
              inputmode="numeric"
              placeholder="精确匹配"
              value={userId()}
              onInput={event => setUserId(event.currentTarget.value)}
            />
          </div>
          <div class="space-y-1.5">
            <Label for="log-ref">流水号</Label>
            <Input
              id="log-ref"
              placeholder="如 adj- 或 rc-"
              value={ref()}
              onInput={event => setRef(event.currentTarget.value)}
            />
          </div>
          <Select
            label="方向"
            options={[
              { value: "all", label: "全部方向" },
              { value: "credit", label: "入账" },
              { value: "debit", label: "扣款" },
            ]}
            value={direction()}
            onChange={value => setDirection(value as "all" | AdjustDirection)}
          />
          <div class="space-y-1.5">
            <Label for="log-start">开始时间</Label>
            <Input
              id="log-start"
              type="datetime-local"
              value={start()}
              onInput={event => setStart(event.currentTarget.value)}
            />
          </div>
          <div class="space-y-1.5">
            <Label for="log-end">结束时间</Label>
            <Input
              id="log-end"
              type="datetime-local"
              value={end()}
              onInput={event => setEnd(event.currentTarget.value)}
            />
          </div>
          <div class="flex items-end gap-2 lg:col-span-2">
            <Button onClick={search}>查询</Button>
            <Button variant="outline" onClick={reset}>
              重置
            </Button>
          </div>
        </div>
      </div>

      <Show when={logs.error()}>
        <div class="border-b px-4 py-6 text-center text-sm">
          <p class="text-muted-foreground">{logs.error()}</p>
          <Button variant="outline" size="sm" class="mt-3" onClick={() => void logs.reload()}>
            重新加载
          </Button>
        </div>
      </Show>

      <Table class="border-b" tableClass="min-w-[1000px]">
        <TableHeader>
          <TableRow>
            <TableHead>时间</TableHead>
            <TableHead>用户</TableHead>
            <TableHead class="text-right">变动金额</TableHead>
            <TableHead class="text-right">变动后余额</TableHead>
            <TableHead>来源</TableHead>
            <TableHead>流水号</TableHead>
            <TableHead>事由</TableHead>
            <TableHead>操作人</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <For each={logs.data().items}>
            {item => (
              <TableRow>
                <TableCell class="tabular-nums text-muted-foreground">
                  {formatDateTime(item.created_at)}
                </TableCell>
                <TableCell>
                  <p class="font-medium">{item.user_name}</p>
                  <p class="text-xs text-muted-foreground">#{item.user_id}</p>
                </TableCell>
                <TableCell
                  class="text-right font-medium tabular-nums"
                  classList={{
                    "text-success-text": item.delta >= 0,
                    "text-destructive-text": item.delta < 0,
                  }}
                >
                  {signedCurrency(item.delta)}
                </TableCell>
                <TableCell class="text-right tabular-nums">
                  {formatCurrency(item.balance_after)}
                </TableCell>
                <TableCell>
                  <Badge variant={item.ref_id.startsWith("rc-") ? "success" : "secondary"}>
                    {sourceLabel(item.ref_id)}
                  </Badge>
                </TableCell>
                <TableCell class="font-mono text-xs text-muted-foreground">{item.ref_id}</TableCell>
                <TableCell class="max-w-[18rem] truncate" title={item.reason}>
                  {item.reason}
                </TableCell>
                <TableCell class="text-muted-foreground">
                  {item.operator || "—"}
                </TableCell>
              </TableRow>
            )}
          </For>

          <Show when={logs.data().items.length === 0}>
            <TableRow>
              <TableCell class="py-10 text-center text-muted-foreground" colSpan={8}>
                {logs.loading() ? "正在加载…" : "没有符合条件的调账记录"}
              </TableCell>
            </TableRow>
          </Show>
        </TableBody>
      </Table>

      <PagerIfNeeded
        page={page()}
        size={size()}
        total={logs.data().total}
        onPageChange={next => {
          setPage(next);
          void logs.reload();
        }}
        onSizeChange={next => {
          setSize(next);
          setPage(1);
          void logs.reload();
        }}
      />
    </Card>
  );
}
