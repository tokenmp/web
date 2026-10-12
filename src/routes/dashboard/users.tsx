import { Title } from "@solidjs/meta";
import Ban from "lucide-solid/icons/ban";
import Copy from "lucide-solid/icons/copy";
import KeyRound from "lucide-solid/icons/key-round";
import Pencil from "lucide-solid/icons/pencil";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import Trash from "lucide-solid/icons/trash";
import UserPlus from "lucide-solid/icons/user-plus";
import Wallet from "lucide-solid/icons/wallet";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";

import { PageHeader, StatRow } from "~/components/layout/page-header";
import { CopyableId } from "~/components/panel/copyable-id";
import { DetailRow, MetricGrid } from "~/components/panel/detail-row";
import { Section } from "~/components/panel/section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Dialog } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Pager } from "~/components/ui/pager";
import { Segmented } from "~/components/ui/segmented";
import { Select } from "~/components/ui/select";
import { Sheet, SheetClose } from "~/components/ui/sheet";
import { Switch } from "~/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Toolbar, ToolbarSearch, ToolbarSpacer } from "~/components/ui/toolbar";
import {
  createUser,
  createUserKey,
  disableUser,
  enableUser,
  fetchPlanOptions,
  fetchUser,
  fetchUserKeys,
  fetchUsers,
  maskApiKey,
  revokeUserKey,
  setUserBudget,
  updateUser,
  userStatusLabel,
  type AdminApiKey,
  type BudgetPeriod,
  type CreatedApiKey,
  type PlanOption,
  type UserBudget,
  type UserSort,
  type UserView,
} from "~/lib/admin-users";
import { createClientResource } from "~/lib/resource";
import {
  BUDGET_PERIOD_LABEL,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  isExpired,
} from "~/lib/utils";

const STATUS_TABS = [
  { value: "all", label: "全部" },
  { value: "1", label: "正常" },
  { value: "0", label: "已封禁" },
] as const;

type StatusFilter = (typeof STATUS_TABS)[number]["value"];

const SORT_OPTIONS = [
  { value: "created_at", label: "注册时间" },
  { value: "updated_at", label: "更新时间" },
  { value: "credit_limit", label: "授信额度" },
  { value: "name", label: "用户名" },
];

const ORDER_TABS = [
  { value: "desc", label: "降序" },
  { value: "asc", label: "升序" },
] as const;

type OrderValue = (typeof ORDER_TABS)[number]["value"];

const PERIOD_OPTIONS = [
  { value: "day", label: "每日" },
  { value: "week", label: "每周" },
  { value: "month", label: "每月" },
];

/** 接口的 status 是 1/0，界面上统一走这两个标签与配色 */
function statusVariant(status: number): "success" | "destructive" {
  return status === 1 ? "success" : "destructive";
}

function planName(plans: PlanOption[], planId: number | null) {
  if (planId === null) return "未绑套餐";
  return plans.find(plan => plan.id === planId)?.name ?? `#${planId}`;
}

/** 预算要先判「启用了没」与「金额是不是 0」，两个条件任一不成立都算没设 */
function budgetEnabled(budget: UserBudget | undefined) {
  return budget !== undefined && budget.enabled === 1 && budget.amount > 0;
}

function budgetAmountLabel(budget: UserBudget | undefined) {
  if (!budget || !budgetEnabled(budget)) return "未设";
  return `${BUDGET_PERIOD_LABEL[budget.period] ?? budget.period} ${formatCurrency(budget.amount)}`;
}

/**
 * 控制台用户管理。
 *
 * 列表、关键词、状态、排序、分页全部走后端：status 参数由服务端拼进 where，
 * 所以 total 是筛选后的总数，页码条与「用户总数」都对得上。
 *
 * 用户被禁用（软删）之后，行内与详情抽屉里都会换成「启用」，这是 issue 点名的恢复入口。
 * 密钥明文只在签发那一次出现，关掉弹窗列表里就只剩前后缀。
 */
export default function DashboardUsers() {
  const [page, setPage] = createSignal(1);
  const [size, setSize] = createSignal(20);
  const [keywordInput, setKeywordInput] = createSignal("");
  const [keyword, setKeyword] = createSignal("");
  const [sort, setSort] = createSignal<UserSort>("created_at");
  const [order, setOrder] = createSignal<OrderValue>("desc");
  const [status, setStatus] = createSignal<StatusFilter>("all");

  const [createOpen, setCreateOpen] = createSignal(false);
  const [pendingDisable, setPendingDisable] = createSignal<UserView | null>(null);
  const [busyId, setBusyId] = createSignal<number | null>(null);
  const [notice, setNotice] = createSignal("");

  const users = createClientResource<{ items: UserView[]; total: number }>(
    () =>
      fetchUsers({
        page: page(),
        size: size(),
        keyword: keyword(),
        // 「全部」就是不传，服务端当不过滤；1/0 直接交给服务端筛
        status: status() === "all" ? undefined : (Number(status()) as 0 | 1),
        sort: sort(),
        order: order(),
      }),
    { items: [], total: 0 },
  );

  // 套餐下拉的数据源。取不到也不影响页面：plan_id 会退化成 #id 显示
  const plans = createClientResource<PlanOption[]>(fetchPlanOptions, []);

  // 关键词敲完停 300ms 再发请求，避免每个字符都打一次接口
  createEffect(() => {
    const value = keywordInput();
    const timer = window.setTimeout(() => {
      setKeyword(value.trim());
      setPage(1);
    }, 300);
    onCleanup(() => window.clearTimeout(timer));
  });

  // 筛选条件变化就重取。第一次不取：createClientResource 挂载时已经取过一回了
  let primed = false;
  createEffect(() => {
    page();
    size();
    keyword();
    status();
    sort();
    order();
    if (!primed) {
      primed = true;
      return;
    }
    void users.reload();
  });

  /** 状态筛选走后端，本页就只统计当前这一页的构成 */
  const stats = () => {
    const list = users.data().items;
    const active = status();
    return [
      {
        label: "用户总数",
        value: formatNumber(users.data().total),
        hint:
          active === "all"
            ? keyword()
              ? "符合当前关键词"
              : "全部账号"
            : active === "1"
              ? "仅正常账号"
              : "仅已封禁账号",
      },
      { label: "本页正常", value: formatNumber(list.filter(user => user.status === 1).length) },
      { label: "本页已封禁", value: formatNumber(list.filter(user => user.status === 0).length) },
      {
        label: "本页设了预算",
        value: formatNumber(list.filter(user => budgetEnabled(user.budget)).length),
        hint: "超预算按用量拦",
      },
    ];
  };

  const restore = async (user: UserView) => {
    setBusyId(user.id);
    setNotice("");
    try {
      await enableUser(user.id);
      await users.reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "启用失败");
    } finally {
      setBusyId(null);
    }
  };

  const runDisable = async () => {
    const user = pendingDisable();
    if (!user) return;

    setBusyId(user.id);
    setNotice("");
    try {
      await disableUser(user.id);
      setPendingDisable(null);
      await users.reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "禁用失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Title>用户 | TokenMP 销售控制台</Title>

      <PageHeader>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus class="size-4" aria-hidden="true" />
          新增用户
        </Button>
      </PageHeader>

      <StatRow items={stats()} />

      <Card class="overflow-hidden">
        <Toolbar>
          <ToolbarSearch
            placeholder="按用户名或邮箱搜索"
            ariaLabel="按用户名或邮箱搜索用户"
            value={keywordInput()}
            onInput={setKeywordInput}
            class="sm:w-64"
          />

          <Segmented
            options={STATUS_TABS}
            value={status()}
            onChange={value => {
              setStatus(value);
              // 筛选条件变了，旧的页码未必还存在，回到第一页
              setPage(1);
            }}
            ariaLabel="按用户状态筛选"
          />

          <ToolbarSpacer />

          <Select
            label="排序"
            labelPlacement="inline"
            // 手机上收窄一档，让刷新按钮能跟排序挤在同一行（390px 下正好差 2px）
            class="w-[7.25rem] sm:w-[8.5rem]"
            options={SORT_OPTIONS}
            value={sort()}
            onChange={value => {
              setSort(value as UserSort);
              setPage(1);
            }}
          />
          <Segmented
            options={ORDER_TABS}
            value={order()}
            onChange={value => {
              setOrder(value);
              setPage(1);
            }}
            ariaLabel="排序方向"
          />
          <Button
            variant="outline"
            size="icon"
            class="shrink-0"
            aria-label="重新加载用户列表"
            disabled={users.loading()}
            onClick={() => void users.reload()}
          >
            <RefreshCw class="size-4" aria-hidden="true" />
          </Button>
        </Toolbar>

        <Show when={notice()}>
          <p
            class="border-b bg-destructive/10 px-4 py-2.5 text-sm text-destructive-text"
            role="alert"
          >
            {notice()}
          </p>
        </Show>

        <Show when={users.error()}>
          <div class="border-b px-4 py-6 text-center text-sm">
            <p class="text-muted-foreground">{users.error()}</p>
            <Button variant="outline" size="sm" class="mt-3" onClick={() => void users.reload()}>
              重新加载
            </Button>
          </div>
        </Show>

        <Table class="border-b" tableClass="min-w-[1100px]">
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>套餐</TableHead>
              <TableHead class="text-right">余额</TableHead>
              <TableHead class="text-right">授信额度</TableHead>
              <TableHead>预算</TableHead>
              <TableHead>注册时间</TableHead>
              <TableHead>状态</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={users.data().items}>
              {user => (
                <TableRow>
                  <TableCell>
                    <p class="font-medium">{user.name}</p>
                    <p class="mt-0.5 text-xs text-muted-foreground">{user.email ?? "未填邮箱"}</p>
                  </TableCell>
                  <TableCell class="text-muted-foreground">
                    {planName(plans.data(), user.plan_id)}
                  </TableCell>
                  <TableCell class="text-right tabular-nums">
                    {formatCurrency(user.balance)}
                  </TableCell>
                  <TableCell class="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(user.credit_limit)}
                  </TableCell>
                  <TableCell class="text-muted-foreground">
                    {budgetAmountLabel(user.budget)}
                  </TableCell>
                  <TableCell class="tabular-nums text-muted-foreground">
                    {formatDate(user.created_at)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(user.status)}>
                      {userStatusLabel(user.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div class="flex items-center justify-end gap-2">
                      <UserDetailSheet
                        user={user}
                        plans={plans.data()}
                        onChanged={() => void users.reload()}
                      />

                      <Show
                        when={user.status === 1}
                        fallback={
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busyId() === user.id}
                            aria-label={`启用用户：${user.name}`}
                            onClick={() => void restore(user)}
                          >
                            <RotateCcw class="size-3.5" aria-hidden="true" />
                            启用
                          </Button>
                        }
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          class="text-destructive-text"
                          disabled={busyId() === user.id}
                          aria-label={`禁用用户：${user.name}`}
                          onClick={() => setPendingDisable(user)}
                        >
                          <Ban class="size-3.5" aria-hidden="true" />
                          禁用
                        </Button>
                      </Show>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </For>

            <Show when={users.data().items.length === 0}>
              <TableRow>
                <TableCell class="py-10 text-center text-muted-foreground" colSpan={8}>
                  {users.loading()
                    ? "正在加载…"
                    : status() !== "all"
                      ? "没有这个状态的用户，切回「全部」看看"
                      : keyword()
                        ? "没有匹配的用户，换个用户名或邮箱关键词试试"
                        : "还没有用户，点右上角「新增用户」建一个"}
                </TableCell>
              </TableRow>
            </Show>
          </TableBody>
        </Table>

        <Pager
          page={page()}
          size={size()}
          total={users.data().total}
          onPageChange={setPage}
          onSizeChange={value => {
            setSize(value);
            setPage(1);
          }}
        />
      </Card>

      <UserFormDialog
        open={createOpen()}
        user={null}
        plans={plans.data()}
        onOpenChange={setCreateOpen}
        onSaved={() => void users.reload()}
      />

      <Dialog
        open={pendingDisable() !== null}
        onOpenChange={open => {
          if (!open) setPendingDisable(null);
        }}
        title="禁用这个用户？"
        description="禁用是软删：账号立刻不能登录与调用，但余额、授信与流水都保留，之后还能再启用。"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDisable(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busyId() === pendingDisable()?.id}
              onClick={() => void runDisable()}
            >
              禁用
            </Button>
          </>
        }
      >
        <Show when={pendingDisable()}>
          <p class="rounded-md bg-muted/60 p-3 text-sm">
            {pendingDisable()!.name} · {pendingDisable()!.email ?? "未填邮箱"}
          </p>
        </Show>
      </Dialog>
    </>
  );
}

/** 行内「详情」入口。抽屉内容是一个独立组件，打开时才挂载并发请求 */
function UserDetailSheet(props: { user: UserView; plans: PlanOption[]; onChanged: () => void }) {
  return (
    <Sheet
      side="right"
      trigger="详情"
      title={props.user.name}
      description={`${props.user.email ?? "未填邮箱"} · 注册于 ${formatDate(props.user.created_at)}`}
      footer={<SheetClose>关闭</SheetClose>}
    >
      <UserDetail user={props.user} plans={props.plans} onChanged={props.onChanged} />
    </Sheet>
  );
}

/**
 * 抽屉正文。
 *
 * Kobalte 的抽屉只在打开时才把内容挂到 DOM，所以这里的 createClientResource
 * 天然是「打开才拉详情与密钥」，不会在列表渲染时给每个用户多发一次请求。
 */
function UserDetail(props: { user: UserView; plans: PlanOption[]; onChanged: () => void }) {
  // 列表行本身就是一份 UserView，先拿来当首帧，同时再请求一次拿最新的
  const detail = createClientResource<UserView>(() => fetchUser(props.user.id), props.user);
  const keys = createClientResource<AdminApiKey[]>(() => fetchUserKeys(props.user.id), []);

  const [editOpen, setEditOpen] = createSignal(false);
  const [budgetOpen, setBudgetOpen] = createSignal(false);
  const [keyOpen, setKeyOpen] = createSignal(false);
  const [created, setCreated] = createSignal<CreatedApiKey | null>(null);
  const [pendingRevoke, setPendingRevoke] = createSignal<AdminApiKey | null>(null);
  const [confirmDisable, setConfirmDisable] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [notice, setNotice] = createSignal("");
  const [copied, setCopied] = createSignal(false);

  const user = () => detail.data();

  const afterChange = () => {
    void detail.reload();
    props.onChanged();
  };

  const setStatus = async (next: 0 | 1) => {
    setBusy(true);
    setNotice("");
    try {
      if (next === 1) await enableUser(user().id);
      else await disableUser(user().id);
      setConfirmDisable(false);
      afterChange();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    const key = pendingRevoke();
    if (!key) return;

    setBusy(true);
    setNotice("");
    try {
      await revokeUserKey(key.id);
      setPendingRevoke(null);
      await keys.reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "吊销失败");
    } finally {
      setBusy(false);
    }
  };

  const copyKey = async () => {
    const text = created()?.key;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // 没有剪贴板权限（非 https 或用户拒绝）时让明文留在屏幕上手动复制
      setCopied(false);
    }
  };

  return (
    <div class="space-y-6">
      <Show when={detail.error()}>
        <div class="rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p class="text-sm text-destructive-text">{detail.error()}</p>
          <Button variant="outline" size="sm" class="mt-2" onClick={() => void detail.reload()}>
            重新加载
          </Button>
        </div>
      </Show>

      <Show when={notice()}>
        <p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text" role="alert">
          {notice()}
        </p>
      </Show>

      <MetricGrid
        items={[
          { label: "可用余额", value: formatCurrency(user().balance) },
          { label: "授信额度", value: formatCurrency(user().credit_limit) },
          { label: "预算上限", value: budgetAmountLabel(user().budget) },
          { label: "本周期已用", value: formatCurrency(user().budget?.used ?? 0) },
        ]}
      />

      <Section title="账户">
        <dl class="space-y-3">
          <DetailRow label="用户 ID" value={<CopyableId value={String(user().id)} />} />
          <DetailRow label="用户名" value={user().name} />
          <DetailRow label="邮箱" value={user().email ?? "未填写"} />
          <DetailRow label="角色" value={user().role === "admin" ? "管理员" : "普通用户"} />
          <DetailRow
            label="状态"
            value={
              <Badge variant={statusVariant(user().status)}>{userStatusLabel(user().status)}</Badge>
            }
          />
          <DetailRow label="套餐" value={planName(props.plans, user().plan_id)} />
          <DetailRow label="注册时间" value={formatDateTime(user().created_at)} />
          <DetailRow label="更新时间" value={formatDateTime(user().updated_at)} />
        </dl>

        <div class="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil class="size-3.5" aria-hidden="true" />
            编辑资料
          </Button>
          <Show
            when={user().status === 1}
            fallback={
              <Button variant="outline" size="sm" disabled={busy()} onClick={() => void setStatus(1)}>
                <RotateCcw class="size-3.5" aria-hidden="true" />
                启用账号
              </Button>
            }
          >
            <Button
              variant="ghost"
              size="sm"
              class="text-destructive-text"
              disabled={busy()}
              onClick={() => setConfirmDisable(true)}
            >
              <Ban class="size-3.5" aria-hidden="true" />
              禁用账号
            </Button>
          </Show>
        </div>
      </Section>

      <Section title="预算封顶">
        <Show
          when={budgetEnabled(user().budget)}
          fallback={<p class="text-muted-foreground">未设预算，调用不受封顶限制</p>}
        >
          <dl class="space-y-3">
            <DetailRow label="上限" value={budgetAmountLabel(user().budget)} />
            <DetailRow label="本周期已用" value={formatCurrency(user().budget.used)} />
            <DetailRow
              label="当前周期"
              value={
                user().budget.period_start
                  ? `${formatDate(user().budget.period_start)} 至 ${formatDate(user().budget.period_end)}`
                  : "—"
              }
            />
          </dl>
        </Show>

        <Button variant="outline" size="sm" class="mt-3" onClick={() => setBudgetOpen(true)}>
          <Wallet class="size-3.5" aria-hidden="true" />
          设预算
        </Button>
      </Section>

      <Show when={user().subscription}>
        {sub => (
          <Section title="当前订阅">
            <dl class="space-y-3">
              <DetailRow label="套餐" value={planName(props.plans, sub().plan_id)} />
              <DetailRow
                label="额度类型"
                value={sub().quota_kind === "requests" ? "按次数" : "按金额"}
              />
              <DetailRow
                label="已用 / 额度"
                value={`${formatCurrency(sub().quota_used)} / ${formatCurrency(sub().quota_limit)}`}
              />
              <DetailRow
                label="周期"
                value={`${formatDate(sub().period_start)} 至 ${formatDate(sub().period_end)}`}
              />
            </dl>
          </Section>
        )}
      </Show>

      <Section title="API 密钥">
        <Show when={keys.error()}>
          <p class="text-sm text-destructive-text">{keys.error()}</p>
        </Show>

        <div class="divide-y rounded-md border">
          <For
            each={keys.data()}
            fallback={
              <p class="p-3 text-sm text-muted-foreground">
                {keys.loading() ? "正在加载…" : "还没有密钥，签发一把才能调用模型"}
              </p>
            }
          >
            {key => (
              <div class="flex items-start justify-between gap-3 p-3">
                <div class="min-w-0">
                  <p class="truncate font-medium">{key.name ?? "未命名密钥"}</p>
                  <p class="mt-0.5 font-mono text-xs text-muted-foreground">{maskApiKey(key)}</p>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    {!key.expires_at
                      ? "永不过期"
                      : isExpired(key.expires_at)
                        ? `已过期（${formatDate(key.expires_at)}）`
                        : `过期于 ${formatDate(key.expires_at)}`}
                    {" · "}
                    {formatDate(key.created_at)} 创建
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  class="shrink-0 text-destructive-text"
                  disabled={busy()}
                  aria-label={`吊销密钥：${key.name ?? key.key_prefix}`}
                  onClick={() => setPendingRevoke(key)}
                >
                  <Trash class="size-3.5" aria-hidden="true" />
                  吊销
                </Button>
              </div>
            )}
          </For>
        </div>

        <Button variant="outline" size="sm" class="mt-3" onClick={() => setKeyOpen(true)}>
          <KeyRound class="size-3.5" aria-hidden="true" />
          签发密钥
        </Button>
      </Section>

      <UserFormDialog
        open={editOpen()}
        user={user()}
        plans={props.plans}
        onOpenChange={setEditOpen}
        onSaved={afterChange}
      />

      <BudgetDialog
        open={budgetOpen()}
        user={user()}
        onOpenChange={setBudgetOpen}
        onSaved={afterChange}
      />

      <KeyCreateDialog
        open={keyOpen()}
        userId={user().id}
        onOpenChange={setKeyOpen}
        onSaved={createdKey => {
          setCopied(false);
          setCreated(createdKey);
          void keys.reload();
        }}
      />

      {/* 明文密钥只在这里出现一次，关掉就只剩前后缀 */}
      <Dialog
        open={created() !== null}
        onOpenChange={open => {
          if (!open) setCreated(null);
        }}
        title="密钥已签发"
        description="明文只展示这一次，后端只存哈希，关掉就再也拿不回来。"
        footer={
          <>
            <Button variant="outline" onClick={() => void copyKey()}>
              <Copy class="size-4" aria-hidden="true" />
              {copied() ? "已复制" : "复制"}
            </Button>
            <Button onClick={() => setCreated(null)}>我已保存</Button>
          </>
        }
      >
        <Show when={created()}>
          <p class="mb-2 text-sm text-muted-foreground">
            {created()!.name ?? "未命名密钥"} 的明文密钥：
          </p>
          <p class="break-all rounded-md bg-muted/60 p-3 font-mono text-xs">{created()!.key}</p>
        </Show>
      </Dialog>

      <Dialog
        open={pendingRevoke() !== null}
        onOpenChange={open => {
          if (!open) setPendingRevoke(null);
        }}
        title="吊销这把密钥？"
        description="吊销是硬删，用这把密钥发起的请求立刻失效，且无法恢复。"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingRevoke(null)}>
              取消
            </Button>
            <Button variant="destructive" disabled={busy()} onClick={() => void revoke()}>
              吊销
            </Button>
          </>
        }
      >
        <Show when={pendingRevoke()}>
          <p class="rounded-md bg-muted/60 p-3 text-sm">
            {pendingRevoke()!.name ?? "未命名密钥"} ·{" "}
            <span class="font-mono text-xs">{maskApiKey(pendingRevoke()!)}</span>
          </p>
        </Show>
      </Dialog>

      <Dialog
        open={confirmDisable()}
        onOpenChange={setConfirmDisable}
        title="禁用这个用户？"
        description="禁用是软删：余额、授信与流水都保留，之后还能再启用。"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDisable(false)}>
              取消
            </Button>
            <Button variant="destructive" disabled={busy()} onClick={() => void setStatus(0)}>
              禁用
            </Button>
          </>
        }
      >
        <p class="rounded-md bg-muted/60 p-3 text-sm">
          {user().name} · {user().email ?? "未填邮箱"}
        </p>
      </Dialog>
    </div>
  );
}

/** 新建与编辑共用。user 为 null 是新建，否则是编辑 */
function UserFormDialog(props: {
  open: boolean;
  user: UserView | null;
  plans: PlanOption[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [role, setRole] = createSignal("user");
  const [creditLimit, setCreditLimit] = createSignal("0");
  const [planId, setPlanId] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [pending, setPending] = createSignal(false);

  const isEdit = () => props.user !== null;

  // 弹窗常驻，每次打开都按当前这条重填，否则会残留上一次的内容
  createEffect(() => {
    if (!props.open) return;
    const user = props.user;
    setName(user?.name ?? "");
    setEmail(user?.email ?? "");
    setPassword("");
    setRole(user?.role ?? "user");
    setCreditLimit(String(user?.credit_limit ?? 0));
    setPlanId(user?.plan_id == null ? "" : String(user.plan_id));
    setNotice("");
    setPending(false);
  });

  const planOptions = () => [
    { value: "", label: "未绑套餐" },
    ...props.plans.map(plan => ({ value: String(plan.id), label: plan.name })),
  ];

  const submit = async () => {
    if (pending()) return;

    const trimmedName = name().trim();
    if (!trimmedName) {
      setNotice("用户名不能为空");
      return;
    }

    const amount = Number(creditLimit());
    if (!Number.isFinite(amount) || amount < 0) {
      setNotice("授信额度必须是不小于 0 的数字");
      return;
    }

    const plain = password();
    if (plain && plain.length < 8) {
      setNotice("密码至少 8 位");
      return;
    }

    const plan = planId() === "" ? null : Number(planId());
    if (plan !== null && !Number.isInteger(plan)) {
      setNotice("套餐选择不合法");
      return;
    }

    setPending(true);
    setNotice("");
    try {
      if (props.user) {
        await updateUser(props.user.id, {
          name: trimmedName,
          email: email().trim() || null,
          role: role() === "admin" ? "admin" : "user",
          credit_limit: amount,
          plan_id: plan,
          ...(plain ? { password: plain } : {}),
        });
      } else {
        await createUser({
          name: trimmedName,
          email: email().trim() || null,
          credit_limit: amount,
          plan_id: plan,
          ...(plain ? { password: plain } : {}),
        });
      }
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
      title={isEdit() ? "编辑用户" : "新增用户"}
      description={
        isEdit()
          ? "留空的字段不会改动；改密码会让该用户所有会话失效"
          : "邮箱与密码可以先不填，账号建起来之后再补"
      }
      footer={
        <>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={pending()} onClick={() => void submit()}>
            {isEdit() ? "保存" : "创建用户"}
          </Button>
        </>
      }
    >
      <div class="space-y-4">
        <div class="space-y-1.5">
          <Label for="user-name">用户名</Label>
          <Input
            id="user-name"
            value={name()}
            placeholder="登录名"
            onInput={event => setName(event.currentTarget.value)}
          />
        </div>

        <div class="space-y-1.5">
          <Label for="user-email">邮箱（可选）</Label>
          <Input
            id="user-email"
            type="email"
            value={email()}
            placeholder="user@example.com"
            onInput={event => setEmail(event.currentTarget.value)}
          />
        </div>

        <div class="space-y-1.5">
          <Label for="user-password">
            {isEdit() ? "新密码（留空则不修改）" : "密码（可选，至少 8 位）"}
          </Label>
          <Input
            id="user-password"
            type="password"
            value={password()}
            placeholder={isEdit() ? "不填就保持原样" : "不填则暂时无法登录"}
            onInput={event => setPassword(event.currentTarget.value)}
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <Label for="user-credit">授信额度</Label>
            <Input
              id="user-credit"
              type="number"
              min="0"
              step="0.01"
              value={creditLimit()}
              onInput={event => setCreditLimit(event.currentTarget.value)}
            />
          </div>

          <Show when={isEdit()}>
            <Select
              label="角色"
              options={[
                { value: "user", label: "普通用户" },
                { value: "admin", label: "管理员" },
              ]}
              value={role()}
              onChange={setRole}
              portal={false}
            />
          </Show>
        </div>

        <Select
          label="套餐"
          options={planOptions()}
          value={planId()}
          onChange={setPlanId}
          portal={false}
        />

        <Show when={notice()}>
          <p class="text-sm text-destructive-text" role="alert">
            {notice()}
          </p>
        </Show>
      </div>
    </Dialog>
  );
}

/** 设预算。关掉开关或金额填 0 都表示清除 */
function BudgetDialog(props: {
  open: boolean;
  user: UserView;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = createSignal(false);
  const [amount, setAmount] = createSignal("");
  const [period, setPeriod] = createSignal<BudgetPeriod>("month");
  const [notice, setNotice] = createSignal("");
  const [pending, setPending] = createSignal(false);

  createEffect(() => {
    if (!props.open) return;
    const budget = props.user.budget;
    setEnabled(budget?.enabled === 1);
    setAmount(budget && budget.amount > 0 ? String(budget.amount) : "");
    setPeriod((budget?.period as BudgetPeriod) ?? "month");
    setNotice("");
    setPending(false);
  });

  const submit = async () => {
    if (pending()) return;

    const value = Number(amount() || 0);
    if (!Number.isFinite(value) || value < 0) {
      setNotice("预算金额必须是不小于 0 的数字");
      return;
    }
    if (enabled() && value === 0) {
      setNotice("启用预算时金额要大于 0；想清掉预算就关掉开关");
      return;
    }

    setPending(true);
    setNotice("");
    try {
      await setUserBudget(props.user.id, { enabled: enabled(), amount: value, period: period() });
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
      title="设置预算封顶"
      description={`${props.user.name} · 超预算的调用会被拦下`}
      footer={
        <>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={pending()} onClick={() => void submit()}>
            保存
          </Button>
        </>
      }
    >
      <div class="space-y-4">
        <Switch
          checked={enabled()}
          onChange={setEnabled}
          label="启用预算封顶"
          ariaLabel="启用预算封顶"
        />

        <div class="space-y-1.5">
          <Label for="budget-amount">金额</Label>
          <Input
            id="budget-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount()}
            placeholder="0 表示清除预算"
            onInput={event => setAmount(event.currentTarget.value)}
          />
          <p class="text-xs text-muted-foreground">关掉开关或把金额填 0 都会清除预算</p>
        </div>

        <Select
          label="周期"
          options={PERIOD_OPTIONS}
          value={period()}
          onChange={value => setPeriod(value as BudgetPeriod)}
          portal={false}
        />

        <Show when={notice()}>
          <p class="text-sm text-destructive-text" role="alert">
            {notice()}
          </p>
        </Show>
      </div>
    </Dialog>
  );
}

/** 签发密钥。成功后把明文交给调用方去弹一次 */
function KeyCreateDialog(props: {
  open: boolean;
  userId: number;
  onOpenChange: (open: boolean) => void;
  onSaved: (created: CreatedApiKey) => void;
}) {
  const [name, setName] = createSignal("");
  const [expiresAt, setExpiresAt] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [pending, setPending] = createSignal(false);

  createEffect(() => {
    if (!props.open) return;
    setName("");
    setExpiresAt("");
    setNotice("");
    setPending(false);
  });

  const submit = async () => {
    if (pending()) return;

    setPending(true);
    setNotice("");
    try {
      const created = await createUserKey(props.userId, {
        name: name().trim() || null,
        expires_at: expiresAt() ? new Date(expiresAt()).toISOString() : null,
      });
      props.onSaved(created);
      props.onOpenChange(false);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "签发失败");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="签发 API 密钥"
      description="名称与过期时间都可以不填，不填就永不过期"
      footer={
        <>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={pending()} onClick={() => void submit()}>
            <KeyRound class="size-4" aria-hidden="true" />
            签发
          </Button>
        </>
      }
    >
      <div class="space-y-4">
        <div class="space-y-1.5">
          <Label for="key-name">名称（可选）</Label>
          <Input
            id="key-name"
            value={name()}
            placeholder="如 生产环境"
            onInput={event => setName(event.currentTarget.value)}
          />
        </div>

        <div class="space-y-1.5">
          <Label for="key-expires">过期时间（可选）</Label>
          <Input
            id="key-expires"
            type="datetime-local"
            value={expiresAt()}
            onInput={event => setExpiresAt(event.currentTarget.value)}
          />
          <p class="text-xs text-muted-foreground">不设置则永不过期</p>
        </div>

        <Show when={notice()}>
          <p class="text-sm text-destructive-text" role="alert">
            {notice()}
          </p>
        </Show>
      </div>
    </Dialog>
  );
}
