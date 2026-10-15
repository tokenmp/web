import { Title } from "@solidjs/meta";
import Copy from "lucide-solid/icons/copy";
import KeyRound from "lucide-solid/icons/key-round";
import Pencil from "lucide-solid/icons/pencil";
import Plus from "lucide-solid/icons/plus";
import Power from "lucide-solid/icons/power";
import Trash from "lucide-solid/icons/trash";
import { createEffect, createMemo, createSignal, Show } from "solid-js";

import { ResponsiveTable } from "~/components/panel/responsive-table";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Dialog } from "~/components/ui/dialog";
import { ErrorState } from "~/components/ui/error-state";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Segmented } from "~/components/ui/segmented";
import { Textarea } from "~/components/ui/textarea";
import { Toolbar, ToolbarSearch, ToolbarSpacer } from "~/components/ui/toolbar";
import { keyStatusMeta } from "~/lib/panel-labels";
import { createClientResource } from "~/lib/resource";
import {
  createApiKey,
  deleteApiKey,
  emptyKeys,
  fetchApiKeys,
  splitModelWhitelist,
  updateApiKey,
  type ApiKeyPatch,
  type PanelApiKey,
} from "~/lib/user-panel";
import {
  formatDate,
  formatDateTime,
  formatRelativeTime,
  isExpired,
  toDateTimeLocal,
} from "~/lib/utils";

const STATUS_TABS = [
  { value: "all", label: "全部状态" },
  { value: "1", label: "启用" },
  // 与状态徽标同一个词：徽标回的是「启用 / 停用」（panel-labels 的 keyStatusMeta），
  // 这里原来写「禁用」，同一个页面里同一件事两种说法
  { value: "0", label: "停用" },
] as const;

type StatusFilter = (typeof STATUS_TABS)[number]["value"];

/** 密钥只回前后缀，中间固定用省略号：既认得出来，也不泄露 */
function maskedKey(key: PanelApiKey) {
  return key.key_suffix ? `${key.key_prefix}……${key.key_suffix}` : `${key.key_prefix}……`;
}

/**
 * 我的密钥。
 *
 * 三处跟「一个列表页」不一样的地方：
 *   - 明文只在创建后弹一次。创建成功之后不再回列表，直接把明文糊在弹窗里，
 *     让人当场复制走 —— 后端也只存哈希，关掉就真没了。
 *   - 过期的密钥单独标出来。过期了接口不报错、只是调用失败，不标的话很难查。
 *   - 停用是一条独立动作，不是删除的替代品：停用之后这把密钥仍留在列表里、
 *     状态标着「停用」，可以再启用回来。所以列表里两者各占一个入口。
 *
 * 名称、过期时间、模型白名单与每分钟限速都能改（PATCH /user/api_keys/{id}，
 * 服务端按 user_id 收窄）。改完重新拉一次列表对齐，不用响应体的形状。
 *
 * 数据来源是 GET /api/user/api_keys；新建、改属性、停用启用与删除都真实落库。
 */
export default function PanelKeys() {
  const { data, loading, error, reload } = createClientResource(fetchApiKeys, emptyKeys);
  const [keyword, setKeyword] = createSignal("");
  const [status, setStatus] = createSignal<StatusFilter>("all");

  const [createOpen, setCreateOpen] = createSignal(false);
  const [name, setName] = createSignal("");
  const [expiresAt, setExpiresAt] = createSignal("");
  const [created, setCreated] = createSignal<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [notice, setNotice] = createSignal("");

  const [pendingDelete, setPendingDelete] = createSignal<PanelApiKey | null>(null);
  const [editing, setEditing] = createSignal<PanelApiKey | null>(null);
  /** 正在停用/启用的那一把，用来禁掉它自己的按钮 */
  const [toggling, setToggling] = createSignal<number | null>(null);

  const keys = () => data().items;

  const filtered = createMemo(() => {
    const query = keyword().trim().toLowerCase();
    return keys().filter(key => {
      const matchStatus = status() === "all" || String(key.status) === status();
      const matchQuery =
        query === "" ||
        (key.name ?? "").toLowerCase().includes(query) ||
        key.key_prefix.toLowerCase().includes(query);
      return matchStatus && matchQuery;
    });
  });

  const resetForm = () => {
    setName("");
    setExpiresAt("");
    setCopied(false);
  };

  const create = async () => {
    const fallbackName = name().trim() || "未命名密钥";
    setNotice("");
    setBusy(true);
    try {
      // 明文由后端在这一次响应里返回，之后任何接口都拿不到
      const issued = await createApiKey({
        name: name().trim() || undefined,
        expires_at: expiresAt() ? new Date(expiresAt()).toISOString() : undefined,
      });
      setCreateOpen(false);
      setCreated({ name: issued.name ?? fallbackName, key: issued.key });
      resetForm();
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "创建密钥失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const target = pendingDelete();
    if (!target) return;
    setNotice("");
    setBusy(true);
    try {
      await deleteApiKey(target.id);
      setPendingDelete(null);
      await reload();
    } catch (err) {
      // 404 多是别人已经删过：提示之后照样重新拉一次，让界面回到服务端的状态
      setNotice(err instanceof Error ? err.message : "删除密钥失败");
      setPendingDelete(null);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  /**
   * 停用 / 启用。不删任何东西 —— 停用之后这一把仍留在列表里、状态标着「停用」，
   * 想再打开就再点一次。用哪一把、用不用是用户自己的判断，界面不替他藏起来。
   */
  const toggleStatus = async (key: PanelApiKey) => {
    if (toggling() !== null) return;
    setNotice("");
    setToggling(key.id);
    const next = key.status === 1 ? 0 : 1;
    try {
      await updateApiKey(key.id, { status: next });
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "改密钥状态失败");
      await reload();
    } finally {
      setToggling(null);
    }
  };

  const copyKey = async () => {
    const text = created()?.key;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // 没有剪贴板权限（非 https、或用户拒绝）时让明文留在屏幕上手动复制
      setCopied(false);
    }
  };

  return (
    <>
      <Title>我的密钥 | tokenmp web</Title>

      <Show when={error()}>
        <ErrorState
          class="mb-4 rounded-lg border border-destructive/30"
          message={error()!}
          onRetry={() => void reload()}
        />
      </Show>
      <Show when={notice()}>
        <p class="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive-text" role="alert">
          {notice()}
        </p>
      </Show>

      <Card class="overflow-hidden">
        <Toolbar>
          <ToolbarSearch
            placeholder="搜索名称 / 前缀"
            ariaLabel="搜索密钥"
            value={keyword()}
            onInput={setKeyword}
            class="sm:w-64"
          />
          <Segmented
            options={STATUS_TABS}
            value={status()}
            onChange={setStatus}
            ariaLabel="按状态筛选密钥"
          />
          {/* 新建密钥管的就是下面这张卡片，放在同一行：上面的页头只剩它一个按钮时
              看起来像没做完的区块，中间还隔着一条错误提示的位置 */}
          <ToolbarSpacer />
          <Button onClick={() => setCreateOpen(true)}>
            <Plus class="size-4" aria-hidden="true" />
            新建密钥
          </Button>
        </Toolbar>

        <ResponsiveTable
          items={filtered()}
          rowKey={key => key.id}
          columns={[
            {
              header: "名称",
              cell: key => (
                <div>
                  <p class="font-medium">{key.name ?? "未命名密钥"}</p>
                  <p class="mt-0.5 font-mono text-xs text-muted-foreground">{maskedKey(key)}</p>
                  <Show when={key.rate_limit_per_min || key.model_whitelist?.length}>
                    <p class="mt-0.5 text-xs text-muted-foreground">
                      {key.rate_limit_per_min ? `${key.rate_limit_per_min} 次/分钟` : ""}
                      {key.rate_limit_per_min && key.model_whitelist?.length ? " · " : ""}
                      {key.model_whitelist?.length
                        ? `限 ${key.model_whitelist.length} 个模型`
                        : ""}
                    </p>
                  </Show>
                </div>
              ),
            },
            {
              header: "状态",
              cell: key => (
                <Badge variant={keyStatusMeta(key.status).variant}>
                  {keyStatusMeta(key.status).label}
                </Badge>
              ),
            },
            {
              header: "过期时间",
              cell: key =>
                !key.expires_at ? (
                  <span class="text-muted-foreground">永不过期</span>
                ) : (
                  <span class={isExpired(key.expires_at) ? "text-destructive-text" : undefined}>
                    {formatDate(key.expires_at)}
                    {isExpired(key.expires_at) ? "（已过期）" : ""}
                  </span>
                ),
            },
            {
              header: "最近使用",
              cell: key =>
                key.last_used_at ? (
                  <span
                    class="text-muted-foreground"
                    title={formatDateTime(key.last_used_at)}
                  >
                    {formatRelativeTime(key.last_used_at)}
                  </span>
                ) : (
                  <span class="text-muted-foreground">从未使用</span>
                ),
            },
            {
              header: "创建时间",
              cell: key => (
                <span class="tabular-nums text-muted-foreground">{formatDate(key.created_at)}</span>
              ),
            },
          ]}
          cardTitle={key => key.name ?? "未命名密钥"}
          cardSubtitle={key => (
            <>
              <span class="font-mono">{maskedKey(key)}</span>
              {key.last_used_at ? ` · 上次 ${formatRelativeTime(key.last_used_at)}` : " · 从未使用"}
            </>
          )}
          cardRight={key => (
            <Badge variant={keyStatusMeta(key.status).variant}>
              {keyStatusMeta(key.status).label}
            </Badge>
          )}
          actions={key => (
            <>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`编辑密钥：${key.name ?? key.key_prefix}`}
                onClick={() => setEditing(key)}
              >
                <Pencil class="size-3.5" aria-hidden="true" />
                编辑
              </Button>
              {/* 停用不是删除的替代品：停用之后这一行仍在，状态改成「停用」，
                  再点一次就能启用回来。删除是另一条路，另给一个入口 */}
              <Button
                variant="ghost"
                size="sm"
                disabled={toggling() === key.id}
                aria-label={`${key.status === 1 ? "停用" : "启用"}密钥：${key.name ?? key.key_prefix}`}
                onClick={() => void toggleStatus(key)}
              >
                <Power class="size-3.5" aria-hidden="true" />
                {toggling() === key.id ? "处理中…" : key.status === 1 ? "停用" : "启用"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="text-destructive-text"
                aria-label={`删除密钥：${key.name ?? key.key_prefix}`}
                onClick={() => setPendingDelete(key)}
              >
                <Trash class="size-3.5" aria-hidden="true" />
                删除
              </Button>
            </>
          )}
          empty={
            loading()
              ? "加载中…"
              : keyword() || status() !== "all"
                ? "没有匹配的密钥"
                : "还没有密钥"
          }
          emptyDescription={
            loading()
              ? undefined
              : keyword() || status() !== "all"
                ? "试试调整搜索词或筛选条件"
                : "创建 API 密钥即可开始调用模型"
          }
        />
      </Card>

      {/* 新建：名称与过期时间都可以不填 */}
      <Dialog
        open={createOpen()}
        onOpenChange={setCreateOpen}
        title="新建密钥"
        description="名称用来区分用途，过期时间不填就永不过期"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={create} disabled={busy()}>
              <KeyRound class="size-4" aria-hidden="true" />
              {busy() ? "创建中…" : "创建密钥"}
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
        </div>
      </Dialog>

      {/* 明文只在这里出现一次，关掉就只剩前后缀。与控制台那两处同一个道理：
          点遮罩、按 Esc、点右上角的 X 都不关，必须走「复制」或「我已保存」 */}
      <Dialog
        open={created() !== null}
        onOpenChange={open => {
          if (!open) setCreated(null);
        }}
        dismissible={false}
        title="密钥已创建"
        description="明文密钥仅在创建后展示一次，请妥善保存。"
        footer={
          <>
            <Button variant="outline" onClick={copyKey}>
              <Copy class="size-4" aria-hidden="true" />
              {copied() ? "已复制" : "复制"}
            </Button>
            <Button onClick={() => setCreated(null)}>我已保存</Button>
          </>
        }
      >
        <Show when={created()}>
          <p class="mb-2 text-sm text-muted-foreground">
            {created()!.name} 的密钥：
          </p>
          <p class="break-all rounded-md bg-muted/60 p-3 font-mono text-xs">
            {created()!.key}
          </p>
        </Show>
      </Dialog>

      <Dialog
        open={pendingDelete() !== null}
        onOpenChange={open => {
          if (!open) setPendingDelete(null);
        }}
        title="删除密钥？"
        description="删除后使用该密钥的请求将立即失效，且无法恢复。"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={remove} disabled={busy()}>
              {busy() ? "删除中…" : "删除"}
            </Button>
          </>
        }
      >
        <Show when={pendingDelete()}>
          <p class="rounded-md bg-muted/60 p-3 text-sm">
            {pendingDelete()!.name ?? "未命名密钥"} ·{" "}
            <span class="font-mono text-xs">{maskedKey(pendingDelete()!)}</span>
          </p>
          {/* 想暂时不让别人用，停用就够了，不必删 —— 删了就再也回不来 */}
          <Show when={pendingDelete()!.status === 1}>
            <p class="mt-2 text-xs text-muted-foreground">
              只想暂时停掉它？关掉这个弹窗，用那一行的「停用」——
              停用的密钥仍在列表里，随时能启用回来；删除不可撤销。
            </p>
          </Show>
        </Show>
      </Dialog>

      <KeyEditDialog
        item={editing()}
        onOpenChange={open => {
          if (!open) setEditing(null);
        }}
        onSaved={() => {
          setEditing(null);
          void reload();
        }}
      />
    </>
  );
}

/**
 * 改属性。与控制台那份同一套形状：四个字段每次一起送，空值表示清掉该限制。
 *
 * 不含状态 —— 停用与启用是列表行上的一个动作，混进这个表单会让人以为
 * 要「保存修改」才生效。改完关掉弹窗并重新拉列表，所以这里不消费响应体。
 */
function KeyEditDialog(props: {
  item: PanelApiKey | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = createSignal("");
  const [expiresAt, setExpiresAt] = createSignal("");
  const [whitelist, setWhitelist] = createSignal("");
  const [rateLimit, setRateLimit] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [pending, setPending] = createSignal(false);

  // 打开时用这一行的当前值填表。item 换成另一把密钥时也要重填，
  // 所以读的是 props.item 而不是 open —— 弹窗不卸载，只切数据
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
    // 空数组与不传不是一回事：不传是「不动这一列」，传 null 才是「不限模型」
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
      title="编辑密钥"
      description="白名单与限速留空表示不限。留空名称会变回「未命名密钥」。"
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
          <Label for="panel-key-name">名称</Label>
          <Input
            id="panel-key-name"
            maxLength={64}
            placeholder="如 生产环境"
            value={name()}
            onInput={event => setName(event.currentTarget.value)}
          />
        </div>

        <div class="space-y-1.5">
          <Label for="panel-key-expires">过期时间</Label>
          <Input
            id="panel-key-expires"
            type="datetime-local"
            value={expiresAt()}
            onInput={event => setExpiresAt(event.currentTarget.value)}
          />
          <p class="text-xs text-muted-foreground">留空表示永不过期</p>
        </div>

        <div class="space-y-1.5">
          <Label for="panel-key-whitelist">模型白名单</Label>
          <Textarea
            id="panel-key-whitelist"
            rows={3}
            placeholder="例如：gpt-4o, claude-sonnet-4"
            value={whitelist()}
            onInput={event => setWhitelist(event.currentTarget.value)}
          />
          <p class="text-xs text-muted-foreground">用逗号或换行分隔，留空表示不限模型</p>
        </div>

        <div class="space-y-1.5">
          <Label for="panel-key-rate">每分钟限速</Label>
          <Input
            id="panel-key-rate"
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
