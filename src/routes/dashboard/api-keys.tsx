import { Title } from "@solidjs/meta";
import Check from "lucide-solid/icons/check";
import Copy from "lucide-solid/icons/copy";
import Pencil from "lucide-solid/icons/pencil";
import Plus from "lucide-solid/icons/plus";
import Search from "lucide-solid/icons/search";
import Trash from "lucide-solid/icons/trash";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

import { PageHeader, StatRow } from "~/components/layout/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Dialog } from "~/components/ui/dialog";
import { ErrorState } from "~/components/ui/error-state";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select } from "~/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";
import { Toolbar } from "~/components/ui/toolbar";
import {
  deleteApiKey,
  fetchAdminUsers,
  fetchUserApiKeys,
  issueApiKey,
  keyState,
  maskedKey,
  splitModelWhitelist,
  updateApiKey,
  type AdminApiKey,
  type AdminUser,
  type ApiKeyPatch,
  type IssuedApiKey,
  type KeyState,
} from "~/lib/admin-keys";
import { createClientResource } from "~/lib/resource";
import { formatDateTime, formatNumber, toDateTimeLocal } from "~/lib/utils";

function stateVariant(state: KeyState) {
  if (state === "启用") return "success" as const;
  if (state === "已过期") return "warning" as const;
  return "secondary" as const;
}

/**
 * 管理端 API 密钥。
 *
 * 管理端没有「列出所有密钥」，只有「某用户的密钥列表」，所以这一页是
 * 「先选用户，再看他的密钥」。用户下拉从 /api/admin/users 取真实的 id。
 *
 * 三个写操作分开：停用与启用走 PATCH 改 status（可逆，密钥留着）；
 * 删除是硬删，单独一个按钮加确认，两者不能互相冒充。
 */
export default function DashboardApiKeys() {
  const [userInput, setUserInput] = createSignal("");
  const [userQuery, setUserQuery] = createSignal("");

  // 用户下拉只铺第一页 100 条（接口的 size 上限就是 100），不铺整份名册：
  // 这一页是「先选一个人，再看他的密钥」，不是逐个浏览用户，几百个选项还带翻页的选择器
  // 比搜索更难用；上面那个「按用户名找用户」的输入框已经是服务端模糊匹配，
  // 找得到具体的人靠它。代价是名单被截断这件事必须写在界面上，见下面的提示。
  const users = createClientResource(
    () => fetchAdminUsers({ size: 100, keyword: userQuery() }),
    { items: [] as AdminUser[], total: 0 },
  );

  const [selected, setSelected] = createSignal<AdminUser | null>(null);
  const [keys, setKeys] = createSignal<AdminApiKey[]>([]);
  const [keysLoading, setKeysLoading] = createSignal(false);
  const [keysError, setKeysError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal("");
  const [busyId, setBusyId] = createSignal<number | null>(null);

  const [issueOpen, setIssueOpen] = createSignal(false);
  const [issued, setIssued] = createSignal<IssuedApiKey | null>(null);
  const [editing, setEditing] = createSignal<AdminApiKey | null>(null);
  const [pendingDelete, setPendingDelete] = createSignal<AdminApiKey | null>(null);

  const userOptions = createMemo(() =>
    users.data().items.map(item => ({
      value: String(item.id),
      label: item.email ? `${item.name}（${item.email}）` : item.name,
    })),
  );

  const stats = () => {
    const list = keys();
    return [
      { label: "密钥总数", value: formatNumber(list.length) },
      {
        label: "启用",
        value: formatNumber(list.filter(key => keyState(key) === "启用").length),
      },
      { label: "已停用", value: formatNumber(list.filter(key => key.status === 0).length) },
      {
        label: "已过期",
        value: formatNumber(list.filter(key => keyState(key) === "已过期").length),
        hint: "建议尽快轮换",
      },
    ];
  };

  const loadKeys = async (userId: number) => {
    setKeysLoading(true);
    setKeysError(null);
    try {
      const page = await fetchUserApiKeys(userId);
      setKeys(page.items ?? []);
    } catch (err) {
      setKeys([]);
      setKeysError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setKeysLoading(false);
    }
  };

  const selectUser = (user: AdminUser) => {
    setNotice("");
    setSelected(user);
    void loadKeys(user.id);
  };

  // 用户列表回来之后默认选中第一个，页面不留一个空表
  createEffect(() => {
    if (selected() !== null) return;
    const first = users.data().items[0];
    if (first) selectUser(first);
  });

  /** 待确认停用的密钥。停用可逆，但会立刻打断对方正在跑的集成，值得先问一句 */
  const [pendingDisable, setPendingDisable] = createSignal<AdminApiKey | null>(null);

  const run = async (key: AdminApiKey, action: () => Promise<unknown>, fallback: string) => {
    setBusyId(key.id);
    setNotice("");
    try {
      await action();
      await loadKeys(key.user_id);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : fallback);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    const key = pendingDelete();
    if (!key) return;

    setBusyId(key.id);
    setNotice("");
    try {
      await deleteApiKey(key.id);
      setPendingDelete(null);
      await loadKeys(key.user_id);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Title>API 密钥 | tokenmp web</Title>

      <PageHeader>
        <Button disabled={selected() === null} onClick={() => setIssueOpen(true)}>
          <Plus class="size-4" aria-hidden="true" />
          签发密钥
        </Button>
      </PageHeader>

      <StatRow items={stats()} />

      <Card class="overflow-hidden">
        <Toolbar>
          <form
            class="flex w-full items-center gap-2 sm:w-auto"
            onSubmit={event => {
              event.preventDefault();
              setUserQuery(userInput().trim());
              void users.reload();
            }}
          >
            <Label for="key-user-search" class="shrink-0 whitespace-nowrap text-muted-foreground">
              按用户名找用户
            </Label>
            <div class="relative w-full sm:w-44">
              <Search
                class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="key-user-search"
                class="pl-9"
                placeholder="用户名，可留空"
                value={userInput()}
                onInput={event => setUserInput(event.currentTarget.value)}
              />
            </div>
            <Button type="submit" variant="outline" class="shrink-0">
              查询
            </Button>
          </form>

          <Select
            label="用户"
            labelPlacement="inline"
            class="w-full sm:w-72"
            options={userOptions()}
            value={selected() ? String(selected()!.id) : null}
            onChange={value => {
              const user = users.data().items.find(item => String(item.id) === value);
              if (user) selectUser(user);
            }}
            placeholder={users.loading() ? "加载中…" : "选择要管理密钥的用户"}
            disabled={users.data().items.length === 0}
          />

          <Show when={selected()}>
            {user => (
              <p class="text-sm text-muted-foreground">
                #{user().id} · {user().name}
                <Show when={user().status === 0}>
                  <Badge variant="secondary" class="ml-2">
                    账号已停用
                  </Badge>
                </Show>
              </p>
            )}
          </Show>
        </Toolbar>

        {/* 下拉只铺得下 100 个，超出的不会出现在选项里。不写出来，管理员会以为
            名单里就这么些人、以为某个用户不存在 */}
        <Show when={users.data().total > users.data().items.length}>
          <p class="border-b bg-warning/15 px-4 py-2.5 text-sm text-warning-text" role="status">
            {userQuery() ? "匹配到" : "用户共"} {formatNumber(users.data().total)} 个，
            上面的下拉只列出前 {formatNumber(users.data().items.length)} 个。
            名单里没有的那个人，用「按用户名找用户」搜一下就会出来 —— 它是服务端匹配，不受这个上限影响。
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

        <Show when={users.error()}>
          <ErrorState
            variant="inline"
            class="border-b px-4"
            message={users.error()!}
            retryLabel="重新加载用户"
            onRetry={() => void users.reload()}
          />
        </Show>

        <Show when={keysError()}>
          <ErrorState
            variant="inline"
            class="border-b px-4"
            message={keysError()!}
            retryLabel="重新加载密钥"
            onRetry={() => {
              const user = selected();
              if (user) void loadKeys(user.id);
            }}
          />
        </Show>

        <Table class="border-b" tableClass="min-w-[1000px]">
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>密钥</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>模型白名单</TableHead>
              <TableHead>限速</TableHead>
              <TableHead>过期时间</TableHead>
              <TableHead>最近使用</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={keys()}>
              {key => (
                <TableRow>
                  <TableCell class="font-medium">
                    {key.name ?? "未命名"}
                    <p class="mt-0.5 text-xs text-muted-foreground">
                      创建于 {formatDateTime(key.created_at)}
                    </p>
                  </TableCell>
                  <TableCell class="font-mono text-xs text-muted-foreground">
                    {maskedKey(key)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={stateVariant(keyState(key))}>{keyState(key)}</Badge>
                  </TableCell>
                  <TableCell class="text-xs text-muted-foreground">
                    <Show
                      when={key.model_whitelist && key.model_whitelist.length > 0}
                      fallback={<>不限</>}
                    >
                      <span class="line-clamp-1 max-w-[16rem]" title={key.model_whitelist?.join(", ")}>
                        {key.model_whitelist?.join(", ")}
                      </span>
                    </Show>
                  </TableCell>
                  <TableCell class="tabular-nums text-muted-foreground">
                    {key.rate_limit_per_min ? `${key.rate_limit_per_min} 次/分` : "不限"}
                  </TableCell>
                  <TableCell class="whitespace-nowrap tabular-nums text-muted-foreground">
                    {key.expires_at ? formatDateTime(key.expires_at) : "永不过期"}
                  </TableCell>
                  <TableCell class="whitespace-nowrap tabular-nums text-muted-foreground">
                    {key.last_used_at ? formatDateTime(key.last_used_at) : "从未使用"}
                  </TableCell>
                  <TableCell>
                    <div class="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId() === key.id}
                        aria-label={`${key.status === 0 ? "启用" : "停用"}密钥：${key.name ?? maskedKey(key)}`}
                        onClick={() => {
                          // 启用是恢复，直接做；停用会立刻打断对方的调用，先确认
                          if (key.status === 0) {
                            void run(key, () => updateApiKey(key.id, { status: 1 }), "操作失败");
                          } else {
                            setPendingDisable(key);
                          }
                        }}
                      >
                        {key.status === 0 ? "启用" : "停用"}
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId() === key.id}
                        aria-label={`编辑密钥：${key.name ?? maskedKey(key)}`}
                        onClick={() => setEditing(key)}
                      >
                        <Pencil class="size-3.5" aria-hidden="true" />
                        编辑
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        class="text-destructive-text"
                        disabled={busyId() === key.id}
                        aria-label={`删除密钥：${key.name ?? maskedKey(key)}`}
                        onClick={() => setPendingDelete(key)}
                      >
                        <Trash class="size-3.5" aria-hidden="true" />
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </For>

            <Show when={keys().length === 0}>
              <TableRow>
                <TableCell class="py-10 text-center text-muted-foreground" colSpan={8}>
                  {!selected()
                    ? "先在上面选一个用户"
                    : keysLoading()
                      ? "正在加载…"
                      : "这个用户还没有密钥，点右上角「签发密钥」给他签一把"}
                </TableCell>
              </TableRow>
            </Show>
          </TableBody>
        </Table>
      </Card>

      <IssueKeyDialog
        open={issueOpen()}
        user={selected()}
        onOpenChange={setIssueOpen}
        onIssued={issued => {
          setIssued(issued);
          const user = selected();
          if (user) void loadKeys(user.id);
        }}
      />

      <KeyEditDialog
        item={editing()}
        onOpenChange={open => {
          if (!open) setEditing(null);
        }}
        onSaved={() => {
          const key = editing();
          setEditing(null);
          if (key) void loadKeys(key.user_id);
        }}
      />

      <Dialog
        open={pendingDisable() !== null}
        onOpenChange={open => {
          if (!open) setPendingDisable(null);
        }}
        title="停用这把密钥？"
        description={`「${pendingDisable()?.name ?? (pendingDisable() ? maskedKey(pendingDisable()!) : "")}」停用后立刻开始被网关拒掉，正在用它的集成会当场失败。密钥本身留着，随时能再启用。`}
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDisable(null)}>
              取消
            </Button>
            <Button
              disabled={busyId() === pendingDisable()?.id}
              onClick={() => {
                const key = pendingDisable();
                if (!key) return;
                setPendingDisable(null);
                void run(key, () => updateApiKey(key.id, { status: 0 }), "操作失败");
              }}
            >
              确认停用
            </Button>
          </>
        }
      />

      <Dialog
        open={pendingDelete() !== null}
        onOpenChange={open => {
          if (!open) setPendingDelete(null);
        }}
        title="删除这把密钥？"
        description="这是硬删，删了之后网关立刻拒掉它，历史记录里也查不到这一把了。"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busyId() === pendingDelete()?.id}
              onClick={() => void remove()}
            >
              确认删除
            </Button>
          </>
        }
      />

      {/* 明文只出现这一次：遮罩、Esc 与右上角的 X 都不关，
          必须显式点「我已经保存好了」 */}
      <Dialog
        open={issued() !== null}
        onOpenChange={open => {
          if (!open) setIssued(null);
        }}
        dismissible={false}
        title="密钥已签发，请立刻保存"
        description="明文只在这一个弹窗里出现一次，关掉之后任何接口都取不回原文，只能删了重签。"
        footer={
          <Button onClick={() => setIssued(null)}>我已经保存好了</Button>
        }
      >
        <Show when={issued()}>
          {key => (
            <div class="space-y-3">
              <div class="rounded-lg border border-warning/50 bg-warning/10 p-3">
                <p class="mb-2 text-xs font-medium text-warning-text">
                  {key().name ?? "未命名"} · 明文密钥
                </p>
                <PlainKey value={key().key} />
              </div>
              <p class="text-xs text-muted-foreground">
                把这段明文直接交给用户，别贴到聊天群或工单里。
              </p>
            </div>
          )}
        </Show>
      </Dialog>
    </>
  );
}

/** 明文密钥：等宽大字加复制按钮，签发后只此一次 */
function PlainKey(props: { value: string }) {
  const [copied, setCopied] = createSignal(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div class="flex items-center gap-2">
      <code class="min-w-0 flex-1 break-all font-mono text-sm">{props.value}</code>
      <Button
        variant="outline"
        size="icon"
        class="shrink-0"
        aria-label="复制明文密钥"
        onClick={() => void copy()}
      >
        <Show when={copied()} fallback={<Copy class="size-4" />}>
          <Check class="size-4 text-success-text" />
        </Show>
      </Button>
    </div>
  );
}

/** 签发弹窗。成功之后不在这里显示明文，交给页面层级的弹窗，免得被关掉时一起没了 */
function IssueKeyDialog(props: {
  open: boolean;
  user: AdminUser | null;
  onOpenChange: (open: boolean) => void;
  onIssued: (key: IssuedApiKey) => void;
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
    const user = props.user;
    if (!user || pending()) return;

    setPending(true);
    setNotice("");
    try {
      const created = await issueApiKey(user.id, {
        name: name().trim() || undefined,
        expires_at: expiresAt() ? new Date(expiresAt()).toISOString() : null,
      });
      props.onOpenChange(false);
      props.onIssued(created);
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
      title="签发新密钥"
      description={
        props.user
          ? `签给 ${props.user.name}（#${props.user.id}）。明文只在提交后的弹窗里出现一次。`
          : "先选一个用户"
      }
      footer={
        <>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={pending() || !props.user} onClick={() => void submit()}>
            {pending() ? "签发中…" : "签发"}
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
          <Label for="issue-key-name">密钥名称</Label>
          <Input
            id="issue-key-name"
            maxLength={64}
            placeholder="例如：生产环境-主密钥"
            value={name()}
            onInput={event => setName(event.currentTarget.value)}
          />
          <p class="text-xs text-muted-foreground">留空也可以，之后能在「编辑」里补</p>
        </div>

        <div class="space-y-1.5">
          <Label for="issue-key-expires">过期时间</Label>
          <Input
            id="issue-key-expires"
            type="datetime-local"
            value={expiresAt()}
            onInput={event => setExpiresAt(event.currentTarget.value)}
          />
          <p class="text-xs text-muted-foreground">留空表示永不过期</p>
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

/** 改属性。属性是子集提交：四个字段每次一起送，空值表示清掉该限制 */
function KeyEditDialog(props: {
  item: AdminApiKey | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = createSignal("");
  const [expiresAt, setExpiresAt] = createSignal("");
  const [whitelist, setWhitelist] = createSignal("");
  const [rateLimit, setRateLimit] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [pending, setPending] = createSignal(false);

  createEffect(() => {
    const item = props.item;
    if (!item) return;
    setName(item.name ?? "");
    setExpiresAt(item.expires_at ? toDateTimeLocal(item.expires_at) : "");
    setWhitelist(item.model_whitelist?.join(", ") ?? "");
    setRateLimit(item.rate_limit_per_min ? String(item.rate_limit_per_min) : "");
    setNotice("");
    setPending(false);
  });

  const submit = async () => {
    const item = props.item;
    if (!item || pending()) return;

    const rate = rateLimit().trim();
    if (rate && (!/^\d+$/.test(rate) || Number(rate) <= 0)) {
      setNotice("限速要是大于 0 的整数");
      return;
    }

    const patch: ApiKeyPatch = {
      name: name().trim() || null,
      expires_at: expiresAt() ? new Date(expiresAt()).toISOString() : null,
      model_whitelist: splitModelWhitelist(whitelist()),
      rate_limit_per_min: rate ? Number(rate) : null,
    };
    if (patch.model_whitelist?.length === 0) patch.model_whitelist = null;

    setPending(true);
    setNotice("");
    try {
      await updateApiKey(item.id, patch);
      props.onSaved();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "保存失败");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={props.item !== null}
      onOpenChange={props.onOpenChange}
      title="编辑密钥属性"
      description="只改填了的内容；白名单与限速清空表示恢复为不限。"
      class="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      footer={
        <>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={pending()} onClick={() => void submit()}>
            {pending() ? "保存中…" : "保存修改"}
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
          <Label for="edit-key-name">密钥名称</Label>
          <Input
            id="edit-key-name"
            maxLength={64}
            value={name()}
            onInput={event => setName(event.currentTarget.value)}
          />
        </div>

        <div class="space-y-1.5">
          <Label for="edit-key-expires">过期时间</Label>
          <Input
            id="edit-key-expires"
            type="datetime-local"
            value={expiresAt()}
            onInput={event => setExpiresAt(event.currentTarget.value)}
          />
          <p class="text-xs text-muted-foreground">留空表示永不过期</p>
        </div>

        <div class="space-y-1.5">
          <Label for="edit-key-whitelist">模型白名单</Label>
          <Textarea
            id="edit-key-whitelist"
            rows={3}
            placeholder="例如：gpt-4o, claude-sonnet-4"
            value={whitelist()}
            onInput={event => setWhitelist(event.currentTarget.value)}
          />
          <p class="text-xs text-muted-foreground">用逗号或换行分隔，留空表示不限模型</p>
        </div>

        <div class="space-y-1.5">
          <Label for="edit-key-rate">每分钟限速</Label>
          <Input
            id="edit-key-rate"
            inputmode="numeric"
            placeholder="例如：120"
            value={rateLimit()}
            onInput={event => setRateLimit(event.currentTarget.value)}
          />
          <p class="text-xs text-muted-foreground">单位是请求数，留空表示不限速</p>
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
