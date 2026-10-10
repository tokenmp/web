import { Title } from "@solidjs/meta";
import Copy from "lucide-solid/icons/copy";
import Plus from "lucide-solid/icons/plus";
import Search from "lucide-solid/icons/search";
import { createMemo, createSignal, For, Show } from "solid-js";

import { PageHeader } from "~/components/layout/page-header";
import { DetailRow } from "~/components/panel/detail-row";
import { ResponsiveTable } from "~/components/panel/responsive-table";
import { Section } from "~/components/panel/section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { DecimalSplit } from "~/components/ui/decimal-split";
import { Dialog } from "~/components/ui/dialog";
import { EmptyState } from "~/components/ui/empty-state";
import { Input } from "~/components/ui/input";
import { Inset } from "~/components/ui/inset";
import { Label } from "~/components/ui/label";
import { Segmented } from "~/components/ui/segmented";
import { Select } from "~/components/ui/select";
import { Sheet, SheetClose } from "~/components/ui/sheet";
import { Switch } from "~/components/ui/switch";
import {
  accountGroups,
  accountUsage,
  sharedAccounts,
  type SharedAccount,
} from "~/lib/panel-data";
import { shareStateMeta } from "~/lib/panel-labels";
import { cn, formatDateTime, formatNumber, formatPoints, formatRelativeTime } from "~/lib/utils";

const VIEW_TABS = [
  { value: "channels", label: "渠道" },
  { value: "accounts", label: "账号" },
] as const;

type ViewFilter = (typeof VIEW_TABS)[number]["value"];

const PRIMARY_GROUPS = accountGroups.filter(group => group.owned_by_me).map(group => group.name);

/**
 * 我的账号。
 *
 * 一个页面两个视角：
 *   渠道 —— 平台开放挂账的渠道组，从这张表挑一个去分享；
 *   账号 —— 已经挂上去的账号，看它有没有被调用、拿没拿到分成。
 *
 * 分享的开关只有两个状态：公开（审核通过后进公共池）与仅自己（只有自己的调用走它）。
 * 线上的状态机是 private / pending / public 三态，pending 表示正在人工审核，
 * 本机把 pending 的账号显示成「审核中」，不给切换按钮。
 */
export default function PanelAccounts() {
  const [view, setView] = createSignal<ViewFilter>("channels");
  const [keyword, setKeyword] = createSignal("");
  const [accounts, setAccounts] = createSignal<SharedAccount[]>(sharedAccounts);

  const [formOpen, setFormOpen] = createSignal(false);
  const [groupId, setGroupId] = createSignal<number | null>(PRIMARY_GROUPS.length ? 7 : null);
  const [accountName, setAccountName] = createSignal("");
  const [apiKey, setApiKey] = createSignal("");
  const [showKey, setShowKey] = createSignal(false);
  const [notice, setNotice] = createSignal("");

  const [pendingDelete, setPendingDelete] = createSignal<SharedAccount | null>(null);

  const query = () => keyword().trim().toLowerCase();

  const groups = createMemo(() =>
    accountGroups.filter(
      group =>
        group.name.toLowerCase().includes(query()) ||
        group.type.toLowerCase().includes(query()),
    ),
  );

  const myAccounts = createMemo(() =>
    accounts().filter(account => account.name.toLowerCase().includes(query())),
  );

  const selectedGroup = () => accountGroups.find(group => group.id === groupId()) ?? null;

  const addAccount = () => {
    if (!groupId()) {
      setNotice("请选择目标渠道组");
      return;
    }
    if (!accountName().trim()) {
      setNotice("请填写账号名称");
      return;
    }
    if (!apiKey().trim()) {
      setNotice("请填写 API Key");
      return;
    }

    // 示例数据：真接后端时这里换成 POST /user/accounts，api_key 只提交不回显
    const group = selectedGroup()!;
    const account: SharedAccount = {
      id: 20 + accounts().length + 1,
      group_id: group.id,
      group_name: group.name,
      name: accountName().trim(),
      channel_name: `${group.name}__${accountName().trim()}`,
      weight: 5,
      cost_multiplier: 1,
      owner_user_id: 263,
      share_rate: group.share_rate ?? 0.1,
      public: false,
      share_state: "pending",
      probe_models: null,
      probe_at: null,
      disabled: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setAccounts(prev => [account, ...prev]);
    setFormOpen(false);
    setAccountName("");
    setApiKey("");
    setGroupId(7);
    setNotice("");
    setView("accounts");
  };

  const togglePublic = (account: SharedAccount, isPublic: boolean) => {
    // 示例数据：真接后端时换成 PATCH /user/accounts/{id} { public }
    setAccounts(prev =>
      prev.map(item =>
        item.id === account.id
          ? {
              ...item,
              public: isPublic,
              share_state: isPublic ? "pending" : "private",
              updated_at: new Date().toISOString(),
            }
          : item,
      ),
    );
  };

  const remove = () => {
    const target = pendingDelete();
    if (!target) return;
    setAccounts(prev => prev.filter(item => item.id !== target.id));
    setPendingDelete(null);
  };

  return (
    <>
      <Title>我的账号 | TokenMP 用户面板</Title>

      <PageHeader description="选择渠道分享你的 API Key，账号被调用时按比例分成">
        <Button onClick={() => setFormOpen(true)}>
          <Plus class="size-4" aria-hidden="true" />
          添加账号
        </Button>
      </PageHeader>

      <Card class="overflow-hidden">
        <div class="flex flex-wrap items-center gap-2 border-b p-4">
          <Segmented options={VIEW_TABS} value={view()} onChange={setView} ariaLabel="切换视角" />
          <div class="relative w-full sm:w-64">
            <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              class="pl-8"
              placeholder={view() === "channels" ? "搜索渠道组" : "搜索账号名称"}
              aria-label={view() === "channels" ? "搜索渠道组" : "搜索账号名称"}
              value={keyword()}
              onInput={event => setKeyword(event.currentTarget.value)}
            />
          </div>
        </div>

        <Show when={view() === "channels"}>
          <ResponsiveTable
            items={groups()}
            rowKey={group => group.id}
            minWidth="min-w-[900px]"
            columns={[
              {
                header: "渠道组",
                cell: group => (
                  <div>
                    <p class="font-medium">
                      {group.name}
                      <Show when={group.owned_by_me}>
                        <Badge variant="outline" class="ml-2">
                          我的
                        </Badge>
                      </Show>
                    </p>
                    <p class="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                      {group.base_url}
                    </p>
                  </div>
                ),
              },
              { header: "类型", cell: group => group.type },
              {
                header: "模型",
                cell: group => (
                  <div class="flex flex-wrap gap-1">
                    <For each={group.models}>
                      {model => <Badge variant="secondary">{model}</Badge>}
                    </For>
                  </div>
                ),
              },
              {
                header: "账号数",
                align: "right",
                cell: group => <span class="tabular-nums">{group.account_count}</span>,
              },
              {
                header: "分成",
                cell: group =>
                  group.share_rate != null ? (
                    <span class="tabular-nums">{Math.round(group.share_rate * 1000) / 10}%</span>
                  ) : (
                    <span class="text-muted-foreground">平台指定</span>
                  ),
              },
            ]}
            cardTitle={group => group.name}
            cardSubtitle={group => `${group.type} · ${group.models.join("、")} · ${group.account_count} 个账号`}
            actions={group => (
              <Button
                variant="outline"
                size="sm"
                aria-label={`分享账号到 ${group.name}`}
                onClick={() => {
                  setGroupId(group.id);
                  setFormOpen(true);
                }}
              >
                分享
              </Button>
            )}
            empty={query() ? "没有匹配的渠道" : "暂无可挂账的渠道"}
            emptyDescription={
              query() ? "试试调整搜索词" : "平台开放挂账的渠道与你申请通过的渠道会出现在这里"
            }
          />
        </Show>

        <Show when={view() === "accounts"}>
          <ResponsiveTable
            items={myAccounts()}
            rowKey={account => account.id}
            minWidth="min-w-[980px]"
            columns={[
              {
                header: "名称",
                cell: account => (
                  <div>
                    <p class="font-medium">{account.name}</p>
                    <p class="mt-0.5 text-xs text-muted-foreground">{account.group_name}</p>
                  </div>
                ),
              },
              {
                header: "权重",
                align: "right",
                cell: account => <span class="tabular-nums">{account.weight}</span>,
              },
              {
                header: "属主",
                cell: account => (account.owner_user_id ? "我" : "平台"),
              },
              {
                header: "分享状态",
                cell: account => (
                  <div class="flex flex-wrap items-center gap-1.5">
                    <Badge variant={shareStateMeta(account.share_state ?? "private").variant}>
                      {shareStateMeta(account.share_state ?? "private").label}
                    </Badge>
                    <Show when={account.probe_at}>
                      <span
                        class="text-xs text-muted-foreground"
                        title={formatDateTime(account.probe_at)}
                      >
                        探测 {formatRelativeTime(account.probe_at)}
                      </span>
                    </Show>
                  </div>
                ),
              },
              {
                header: "创建时间",
                cell: account => (
                  <span class="tabular-nums text-muted-foreground">
                    {formatDateTime(account.created_at)}
                  </span>
                ),
              },
            ]}
            cardTitle={account => account.name}
            cardSubtitle={account =>
              `${account.group_name} · 权重 ${account.weight} · ${formatRelativeTime(account.updated_at)}`
            }
            cardRight={account => (
              <Badge variant={shareStateMeta(account.share_state ?? "private").variant}>
                {shareStateMeta(account.share_state ?? "private").label}
              </Badge>
            )}
            actions={account => <AccountActions account={account} onToggle={togglePublic} onDelete={setPendingDelete} />}
            empty={query() ? "没有匹配的账号" : "暂无账号"}
            emptyDescription={
              query() ? "试试调整搜索词" : "在渠道视图点「分享」，把你的上游 API Key 挂到渠道"
            }
          />
        </Show>
      </Card>

      {/* 添加账号 */}
      <Dialog
        open={formOpen()}
        onOpenChange={setFormOpen}
        title="分享账号"
        description="将你的上游 API Key 挂到渠道，账号被调用时按比例分成"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button onClick={addAccount}>添加账号</Button>
          </>
        }
      >
        <div class="space-y-4">
          <div class="space-y-1.5">
            <Select
              label="目标渠道组"
              placeholder="选择目标渠道组"
              options={accountGroups.map(group => ({
                value: String(group.id),
                label: `${group.name} · ${group.owned_by_me ? "我的" : "平台指定"}`,
              }))}
              value={groupId() === null ? null : String(groupId())}
              onChange={value => setGroupId(Number(value))}
              // 弹层不挂到 body：对话框的焦点陷阱与 aria-hide 会把 portal 出去的内容挡在外面
              portal={false}
            />
            <p class="text-xs text-muted-foreground">
              平台开放挂账的渠道组，以及你申请通过的组会出现在这里。
            </p>
          </div>

          <Show when={selectedGroup()}>
            <div class="space-y-1.5">
              <Label>渠道 Base URL</Label>
              <div class="flex items-center gap-2">
                <Input readOnly value={selectedGroup()!.base_url} class="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  class="shrink-0"
                  aria-label="复制 Base URL"
                  onClick={() => void navigator.clipboard.writeText(selectedGroup()!.base_url).catch(() => undefined)}
                >
                  <Copy class="size-4" />
                </Button>
              </div>
              <p class="text-xs text-muted-foreground">调用该渠道时用这个地址，由平台网关统一转发</p>
            </div>
          </Show>

          <div class="space-y-1.5">
            <Label for="account-name">账号名称</Label>
            <Input
              id="account-name"
              value={accountName()}
              placeholder="如 账号A"
              onInput={event => setAccountName(event.currentTarget.value)}
            />
          </div>

          <div class="space-y-1.5">
            <Label for="account-key">API Key（必填，加密存储）</Label>
            <div class="relative">
              <Input
                id="account-key"
                type={showKey() ? "text" : "password"}
                class="pr-10 font-mono text-xs"
                value={apiKey()}
                placeholder="sk-…"
                onInput={event => setApiKey(event.currentTarget.value)}
              />
              <button
                type="button"
                onClick={() => setShowKey(value => !value)}
                class="absolute right-1 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {showKey() ? "隐藏密钥" : "显示密钥"}
              </button>
            </div>
            <p class="text-xs text-muted-foreground">
              提交后由平台探测可用模型；任何接口都不会再回显这个 Key。
            </p>
          </div>

          <Show when={notice()}>
            <p class="text-sm text-destructive-text" role="alert">
              {notice()}
            </p>
          </Show>
        </div>
      </Dialog>

      <Dialog
        open={pendingDelete() !== null}
        onOpenChange={open => {
          if (!open) setPendingDelete(null);
        }}
        title="删除账号？"
        description="删除后该账号将从账号池移除，无法恢复。"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={remove}>
              删除
            </Button>
          </>
        }
      >
        <Show when={pendingDelete()}>
          <p class="rounded-md bg-muted/60 p-3 text-sm">
            {pendingDelete()!.name} · {pendingDelete()!.group_name}
          </p>
        </Show>
      </Dialog>
    </>
  );
}

/** 账号行的操作：公开开关（审核中的不给切）+ 用量 + 删除 */
function AccountActions(props: {
  account: SharedAccount;
  onToggle: (account: SharedAccount, isPublic: boolean) => void;
  onDelete: (account: SharedAccount) => void;
}) {
  const reviewing = () => props.account.share_state === "pending";

  return (
    <div class="flex flex-wrap items-center justify-end gap-3">
      <Switch
        checked={Boolean(props.account.public)}
        disabled={reviewing()}
        onChange={checked => props.onToggle(props.account, checked)}
        label={reviewing() ? "审核中" : "公开"}
        ariaLabel={`公开分享 ${props.account.name}`}
        title={
          reviewing()
            ? "公开申请已提交，平台审核通过后上架"
            : props.account.public
              ? "已上架：所有用户都能调用"
              : "仅自己：只有我的调用会走它"
        }
      />

      <Sheet
        trigger="用量"
        title={props.account.name}
        description={`${props.account.group_name} · ${props.account.channel_name}`}
        footer={<SheetClose>关闭</SheetClose>}
      >
        <AccountUsagePanel account={props.account} />
      </Sheet>

      <Button
        variant="ghost"
        size="sm"
        class="text-destructive-text"
        aria-label={`删除账号：${props.account.name}`}
        onClick={() => props.onDelete(props.account)}
      >
        删除
      </Button>
    </div>
  );
}

/** 账号被调用了多少：一段汇总加一张明细 */
function AccountUsagePanel(props: { account: SharedAccount }) {
  const usage = () => accountUsage(props.account);

  return (
    <div class="space-y-5">
      <dl class="grid grid-cols-2 gap-3">
        <Inset class="p-3">
          <dt class="text-xs text-muted-foreground">调用次数</dt>
          <dd class="mt-1 text-lg font-semibold tabular-nums">
            {formatNumber(usage().requests)}
          </dd>
        </Inset>
        <Inset class="p-3">
          <dt class="text-xs text-muted-foreground">累计分成</dt>
          <dd class="mt-1 text-lg font-semibold">
            <DecimalSplit text={formatPoints(usage().credit)} />
            <span class="ml-1 text-xs font-normal text-muted-foreground">积分</span>
          </dd>
        </Inset>
      </dl>

      <Show
        when={usage().records.length > 0}
        fallback={<EmptyState title="暂无调用" description="该账号还没有被别人调用过" />}
      >
        <Section title="调用明细" caption="自用 = 我自己发起的调用，不计分成">
          <ul class="divide-y">
            <For each={usage().records}>
              {record => (
                <li class="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div class="min-w-0">
                    <p class="truncate font-mono text-xs">{record.request_id}</p>
                    <p class="mt-0.5 text-xs text-muted-foreground">
                      {record.model} · {formatNumber(record.prompt_tokens + record.completion_tokens)} tok ·{" "}
                      {formatRelativeTime(record.created_at)}
                    </p>
                  </div>
                  <div class="shrink-0 text-right">
                    <Show
                      when={!record.self_owned}
                      fallback={<Badge variant="secondary">自用</Badge>}
                    >
                      <DecimalSplit
                        text={formatPoints(record.owner_credit_amount)}
                        class="text-sm font-medium"
                      />
                      <p class="text-[11px] text-muted-foreground">分成</p>
                    </Show>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Section>
      </Show>

      <dl class="space-y-2.5 text-sm">
        <DetailRow label="渠道" value={props.account.group_name ?? "—"} />
        <DetailRow label="探测模型" value={props.account.probe_models ?? "尚未探测"} />
        <DetailRow
          label="探测时间"
          value={props.account.probe_at ? formatDateTime(props.account.probe_at) : "—"}
        />
      </dl>
    </div>
  );
}
