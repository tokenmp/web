import { Title } from "@solidjs/meta";
import Plus from "lucide-solid/icons/plus";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

import { PageHeader, StatRow } from "~/components/layout/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Dialog } from "~/components/ui/dialog";
import { ErrorState } from "~/components/ui/error-state";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { PagerIfNeeded } from "~/components/ui/pager";
import { Segmented } from "~/components/ui/segmented";
import { Select } from "~/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Toolbar, ToolbarSpacer } from "~/components/ui/toolbar";
import { Textarea } from "~/components/ui/textarea";
import { fetchAdminUsers, type AdminUser } from "~/lib/admin-keys";
import {
  fetchAdminNotifications,
  sendAdminNotifications,
  type AdminNotification,
  type NotificationInput,
  type NotificationSeverity,
} from "~/lib/admin-notifications";
import { createClientResource } from "~/lib/resource";
import { severityLabels } from "~/lib/system";
import { formatDateTime, formatNumber } from "~/lib/utils";

const SEVERITY_OPTIONS: { value: NotificationSeverity; label: string }[] = [
  { value: "info", label: severityLabels.info },
  { value: "warning", label: severityLabels.warning },
  { value: "urgent", label: severityLabels.urgent },
];

type TargetMode = "single" | "batch";

const TARGET_OPTIONS: { value: TargetMode; label: string }[] = [
  { value: "single", label: "单个用户" },
  { value: "batch", label: "批量用户" },
];

/** 筛选下拉里代表「不筛用户」的哨兵值。Kobalte 的空串当成未选，会显示成 placeholder */
const ALL_USERS = "all";

function severityVariant(severity: string): "secondary" | "warning" | "destructive" {
  if (severity === "urgent") return "destructive";
  if (severity === "warning") return "warning";
  return "secondary";
}

/** 批量输入框：逗号、中文逗号、空白都当分隔符；非数字与重复的 id 直接丢掉 */
function parseUserIds(text: string) {
  const ids = text
    .split(/[\s,，]+/)
    .map(item => Number(item.trim()))
    .filter(id => Number.isInteger(id) && id > 0);
  return [...new Set(ids)];
}

/**
 * 通知投递。
 *
 * 与公告的分工：公告面向全站，在「公告」页写；这一页是给单个或一批用户
 * 单独发通知，只落进对方的通知铃铛。
 *
 * idempotency_key 的行为由后端定：带键时按它去重，批量发会在键后接上用户 id。
 * 运营最容易在这里踩坑，所以表单里把这句话写在输入框下面。
 */
export default function DashboardNotifications() {
  const [page, setPage] = createSignal(1);
  const [size, setSize] = createSignal(20);
  const [filterUserId, setFilterUserId] = createSignal(ALL_USERS);
  const [typeInput, setTypeInput] = createSignal("");
  const [filterType, setFilterType] = createSignal("");
  const [formOpen, setFormOpen] = createSignal(false);
  const [notice, setNotice] = createSignal("");
  const [okNotice, setOkNotice] = createSignal("");


  const users = createClientResource<AdminUser[]>(
    () => fetchAdminUsers({ size: 100 }).then(result => result.items),
    [],
  );

  const feed = createClientResource(
    () =>
      fetchAdminNotifications({
        page: page(),
        size: size(),
        user_id: filterUserId() !== ALL_USERS ? Number(filterUserId()) : undefined,
        type: filterType() || undefined,
      }),
    { items: [] as AdminNotification[], total: 0 },
  );

  const userName = createMemo(() => new Map(users.data().map(user => [user.id, user.name])));

  const userOptions = createMemo(() => [
    { value: ALL_USERS, label: "全部用户" },
    ...users.data().map(user => ({
      value: String(user.id),
      label: user.email ? `${user.name}（${user.email}）` : user.name,
    })),
  ]);

  const stats = () => {
    const list = feed.data().items;
    return [
      { label: "投递总数", value: formatNumber(feed.data().total) },
      { label: "本页未读", value: formatNumber(list.filter(item => !item.read_at).length) },
      {
        label: "本页重要",
        value: formatNumber(list.filter(item => item.severity === "urgent").length),
      },
      {
        label: "本页带幂等键",
        value: formatNumber(list.filter(item => item.idempotency_key).length),
      },
    ];
  };

  const reload = (resetPage = false) => {
    if (resetPage) setPage(1);
    void feed.reload();
  };

  return (
    <>
      <Title>通知投递 | tokenmp web</Title>

      <PageHeader>
        <Button onClick={() => setFormOpen(true)}>
          <Plus class="size-4" aria-hidden="true" />
          发通知
        </Button>
      </PageHeader>

      <div class="mb-4 rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
        <p>
          <span class="font-medium text-foreground">公告</span>
          面向全站用户，在「公告」页写，发布后每个用户都会看到；
        </p>
        <p class="mt-1">
          <span class="font-medium text-foreground">通知</span>
          只发给指定用户，在这里投递，只出现在对方的通知铃铛里。
        </p>
      </div>

      <StatRow items={stats()} />

      <Card class="overflow-hidden">
        {/* 用户列表挂了不会让这一页整体不可用（投递记录还在），但接收用户的筛选和
            用户名那一列都会退化：下拉只剩「全部用户」，表格里全变成「用户 #id」。
            单独摆一条，别让管理员以为自己没有别的用户 */}
        <Show when={users.error()}>
          <ErrorState
            variant="inline"
            class="border-b px-4"
            message={`用户列表读取失败：${users.error()}`}
            retryLabel="重新加载用户"
            onRetry={() => void users.reload()}
          />
        </Show>

        <Toolbar>
          <Select
            label="接收用户"
            labelPlacement="inline"
            class="w-full sm:w-56"
            options={userOptions()}
            value={filterUserId()}
            onChange={value => {
              setFilterUserId(value);
              reload(true);
            }}
            placeholder="全部用户"
          />

          <form
            class="flex w-full items-center gap-2 sm:w-auto"
            onSubmit={event => {
              event.preventDefault();
              setFilterType(typeInput().trim());
              reload(true);
            }}
          >
            <Label
              for="notification-type-filter"
              class="shrink-0 whitespace-nowrap text-muted-foreground"
            >
              通知类型
            </Label>
            <Input
              id="notification-type-filter"
              class="w-full sm:w-48"
              placeholder="例如 balance_low"
              value={typeInput()}
              onInput={event => setTypeInput(event.currentTarget.value)}
            />
            <Button type="submit" variant="outline" class="shrink-0">
              筛选
            </Button>
          </form>

          <ToolbarSpacer />

          <p class="text-sm text-muted-foreground" aria-live="polite">
            共 {formatNumber(feed.data().total)} 条
          </p>
        </Toolbar>

        <Show when={okNotice()}>
          <p class="border-b bg-success/10 px-4 py-2.5 text-sm text-success-text" role="status">
            {okNotice()}
          </p>
        </Show>

        <Show when={notice()}>
          <p
            class="border-b bg-destructive/10 px-4 py-2.5 text-sm text-destructive-text"
            role="alert"
          >
            {notice()}
          </p>
        </Show>

        <Show when={feed.error()}>
          <ErrorState
            variant="inline"
            class="border-b px-4"
            message={feed.error()!}
            onRetry={() => void feed.reload()}
          />
        </Show>

        <Table tableClass="min-w-[960px]">
          <TableHeader>
            <TableRow>
              <TableHead>接收用户</TableHead>
              <TableHead>内容</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>级别</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>幂等键</TableHead>
              <TableHead>投递时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={feed.data().items}>
              {item => (
                <TableRow>
                  <TableCell class="whitespace-nowrap">
                    <p class="font-medium">
                      {userName().get(item.user_id) ?? `用户 #${item.user_id}`}
                    </p>
                    <p class="mt-0.5 text-xs text-muted-foreground">#{item.user_id}</p>
                  </TableCell>
                  <TableCell>
                    <p class="font-medium">{item.title}</p>
                    <Show when={item.body}>
                      <p class="mt-0.5 line-clamp-2 max-w-[24rem] text-xs text-muted-foreground">
                        {item.body}
                      </p>
                    </Show>
                    <Show when={item.action_url}>
                      <p class="mt-0.5 text-xs text-muted-foreground">
                        按钮「{item.action_label ?? "查看"}」→ {item.action_url}
                      </p>
                    </Show>
                  </TableCell>
                  <TableCell class="font-mono text-xs text-muted-foreground">
                    {item.type || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={severityVariant(item.severity)}>
                      {severityLabels[item.severity] ?? item.severity}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.read_at ? "secondary" : "outline"}>
                      {item.read_at ? "已读" : "未读"}
                    </Badge>
                  </TableCell>
                  <TableCell class="font-mono text-xs text-muted-foreground">
                    {item.idempotency_key ?? "—"}
                  </TableCell>
                  <TableCell class="whitespace-nowrap tabular-nums text-muted-foreground">
                    {formatDateTime(item.created_at)}
                  </TableCell>
                </TableRow>
              )}
            </For>

            <Show when={feed.data().items.length === 0}>
              <TableRow>
                <TableCell class="py-10 text-center text-muted-foreground" colSpan={7}>
                  {feed.loading() ? "正在加载…" : "还没有投递记录，点右上角「发通知」发一条"}
                </TableCell>
              </TableRow>
            </Show>
          </TableBody>
        </Table>

        <div class="border-t">
          <PagerIfNeeded
            page={page()}
            size={size()}
            total={feed.data().total}
            onPageChange={next => {
              setPage(next);
              void feed.reload();
            }}
            onSizeChange={next => {
              setSize(next);
              setPage(1);
              void feed.reload();
            }}
          />
        </div>
      </Card>

      <NotificationForm
        open={formOpen()}
        users={users.data()}
        usersError={users.error() ?? undefined}
        onOpenChange={setFormOpen}
        onSent={created => {
          setNotice("");
          setOkNotice(`已投递给 ${formatNumber(created)} 个用户`);
          setFormOpen(false);
          void feed.reload();
        }}
      />
    </>
  );
}

/** 发通知表单。受控在页面里，成功之后由页面刷新列表并提示条数 */
function NotificationForm(props: {
  open: boolean;
  users: AdminUser[];
  /** 用户列表取不到时下拉只剩「全部用户」。说出来，别让人以为是加载慢 */
  usersError?: string;
  onOpenChange: (open: boolean) => void;
  onSent: (created: number) => void;
}) {
  const [mode, setMode] = createSignal<TargetMode>("single");
  const [userId, setUserId] = createSignal<string | null>(null);
  const [batchText, setBatchText] = createSignal("");
  const [type, setType] = createSignal("");
  const [title, setTitle] = createSignal("");
  const [body, setBody] = createSignal("");
  const [severity, setSeverity] = createSignal<NotificationSeverity>("info");
  const [actionLabel, setActionLabel] = createSignal("");
  const [actionUrl, setActionUrl] = createSignal("");
  const [expiresAt, setExpiresAt] = createSignal("");
  const [idempotencyKey, setIdempotencyKey] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [pending, setPending] = createSignal(false);
  /** 待确认的发送。批量发出去收不回来，先在弹窗里确认一次影响范围 */
  const [confirming, setConfirming] = createSignal(false);

  // 每次打开重置，弹窗常驻页面里，不重置会残留上一条
  createEffect(() => {
    if (!props.open) return;
    setMode("single");
    setUserId(null);
    setBatchText("");
    setType("");
    setTitle("");
    setBody("");
    setSeverity("info");
    setActionLabel("");
    setActionUrl("");
    setExpiresAt("");
    setIdempotencyKey("");
    setNotice("");
    setPending(false);
    setConfirming(false);
  });

  const userOptions = createMemo(() =>
    props.users.map(user => ({
      value: String(user.id),
      label: user.email ? `${user.name}（${user.email}）` : user.name,
    })),
  );

  const batchIds = createMemo(() => parseUserIds(batchText()));
  const batchUnknown = createMemo(() => {
    const known = new Set(props.users.map(user => user.id));
    return batchIds().filter(id => !known.has(id));
  });

  const targets = () => (mode() === "single" ? (userId() ? 1 : 0) : batchIds().length);

  /**
   * 校验通过之后先开确认弹窗，不在这里直接发。
   * 批量发送面向一批用户、发出去收不回来，按钮上写着「发送给 N 个用户」
   * 也不该等于点一下就发。
   */
  const submit = () => {
    if (pending()) return;

    if (!title().trim()) {
      setNotice("标题不能为空");
      return;
    }
    if (mode() === "single" && !userId()) {
      setNotice("先选一个要接收通知的用户");
      return;
    }
    if (mode() === "batch" && batchIds().length === 0) {
      setNotice("批量发送要至少填一个用户 id");
      return;
    }

    setNotice("");
    setConfirming(true);
  };

  /** 确认之后真正发出去 */
  const send = async () => {
    const input: NotificationInput = {
      title: title().trim(),
      type: type().trim() || undefined,
      body: body().trim() || null,
      severity: severity(),
      action_label: actionLabel().trim() || null,
      action_url: actionUrl().trim() || null,
      expires_at: expiresAt() ? new Date(expiresAt()).toISOString() : null,
      idempotency_key: idempotencyKey().trim() || null,
    };
    if (mode() === "single") input.user_id = Number(userId());
    else input.user_ids = batchIds();

    setPending(true);
    setNotice("");
    try {
      const result = await sendAdminNotifications(input);
      props.onSent(result.created);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "发送失败");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        title="发通知"
        description="只发给选中的用户，不写公告"
        class="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        footer={
          <>
            <Button variant="outline" onClick={() => props.onOpenChange(false)}>
              取消
            </Button>
            <Button disabled={pending()} onClick={() => void submit()}>
              {pending()
                ? "发送中…"
                : targets() > 1
                  ? `发送给 ${formatNumber(targets())} 个用户`
                  : "发送"}
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
            <p class="text-sm font-medium">发送对象</p>
            <Segmented
              options={TARGET_OPTIONS}
              value={mode()}
              onChange={setMode}
              ariaLabel="发送对象"
            />
          </div>

          <Show
            when={mode() === "single"}
            fallback={
              <div class="space-y-1.5">
                <Label for="notification-batch">用户 ID 列表</Label>
                <Textarea
                  id="notification-batch"
                  rows={3}
                  placeholder="例如：12, 34, 56（逗号或换行分隔）"
                  value={batchText()}
                  onInput={event => setBatchText(event.currentTarget.value)}
                />
                <p class="text-xs text-muted-foreground">
                  已识别 {formatNumber(batchIds().length)} 个 id
                  <Show when={batchUnknown().length > 0}>
                    {" "}
                    · 其中 {batchUnknown().join("、")} 不在用户列表里，接口会整批拒绝
                  </Show>
                </p>
              </div>
            }
          >
            <Select
              label="接收用户"
              options={userOptions()}
              value={userId()}
              onChange={setUserId}
              placeholder={
                props.users.length === 0
                  ? props.usersError
                    ? "用户列表没取到，改不了这一项"
                    : "用户列表加载中…"
                  : "选择用户"
              }
              portal={false}
            />
          </Show>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="notification-type">类型</Label>
              <Input
                id="notification-type"
                maxLength={64}
                placeholder="例如 balance_low"
                value={type()}
                onInput={event => setType(event.currentTarget.value)}
              />
            </div>

            <div class="space-y-1.5">
              <Label for="notification-severity">级别</Label>
              <Segmented
                options={SEVERITY_OPTIONS}
                value={severity()}
                onChange={setSeverity}
                ariaLabel="通知级别"
              />
            </div>
          </div>

          <div class="space-y-1.5">
            <Label for="notification-title">标题</Label>
            <Input
              id="notification-title"
              maxLength={255}
              placeholder="例如：余额不足，请及时充值"
              value={title()}
              onInput={event => setTitle(event.currentTarget.value)}
            />
          </div>

          <div class="space-y-1.5">
            <Label for="notification-body">正文</Label>
            <Textarea
              id="notification-body"
              rows={3}
              placeholder="一句话说清发生了什么、用户需要做什么"
              value={body()}
              onInput={event => setBody(event.currentTarget.value)}
            />
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="notification-action-label">按钮文字</Label>
              <Input
                id="notification-action-label"
                maxLength={128}
                placeholder="例如：去充值"
                value={actionLabel()}
                onInput={event => setActionLabel(event.currentTarget.value)}
              />
            </div>

            <div class="space-y-1.5">
              <Label for="notification-action-url">按钮链接</Label>
              <Input
                id="notification-action-url"
                maxLength={512}
                placeholder="/panel/credits"
                value={actionUrl()}
                onInput={event => setActionUrl(event.currentTarget.value)}
              />
            </div>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="notification-expires">过期时间</Label>
              <Input
                id="notification-expires"
                type="datetime-local"
                value={expiresAt()}
                onInput={event => setExpiresAt(event.currentTarget.value)}
              />
              <p class="text-xs text-muted-foreground">留空表示不过期</p>
            </div>

            <div class="space-y-1.5">
              <Label for="notification-idempotency">幂等键</Label>
              <Input
                id="notification-idempotency"
                maxLength={120}
                placeholder="例如 balance_low:2026-07-01"
                value={idempotencyKey()}
                onInput={event => setIdempotencyKey(event.currentTarget.value)}
              />
            </div>
          </div>

          <p class="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            填了幂等键就按它去重：同一个业务事件重复提交只落一条，适合「余额不足」这种每天都会触发的事件。
            批量发送时服务端会在键后接上用户 id（
            <span class="font-mono">balance_low:2026-07-01:12</span>
            ），每个用户各一条，所以批量场景下不要指望一个键全站只发一次。
            不填键则每点一次都真的多一条，别连点两次。
          </p>

          <Show when={notice()}>
            <p class="text-sm text-destructive-text" role="alert">
              {notice()}
            </p>
          </Show>
        </form>
      </Dialog>

      {/* 发送前的确认。与表单分开一个弹窗：这里只放影响范围和那一次点击 */}
      <Dialog
        open={confirming()}
        onOpenChange={open => {
          if (!open && !pending()) setConfirming(false);
        }}
        title={targets() > 1 ? `发给 ${formatNumber(targets())} 个用户？` : "发出这条通知？"}
        description="通知发出去收不回来，只能等它过期或者用户自己关掉。"
        footer={
          <>
            <Button variant="outline" disabled={pending()} onClick={() => setConfirming(false)}>
              再改改
            </Button>
            <Button
              disabled={pending()}
              onClick={() => {
                setConfirming(false);
                void send();
              }}
            >
              {pending() ? "发送中…" : "确认发送"}
            </Button>
          </>
        }
      >
        <div class="space-y-2 text-sm">
          <p class="font-medium">{title().trim()}</p>
          <Show when={body().trim()}>
            <p class="text-muted-foreground">{body().trim()}</p>
          </Show>
          <p class="text-xs text-muted-foreground">
            {targets() > 1
              ? `接收人：${formatNumber(targets())} 个用户（按 id 批量）`
              : "接收人：1 个用户"}
          </p>
        </div>
      </Dialog>
    </>
  );
}
