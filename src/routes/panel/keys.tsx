import { Title } from "@solidjs/meta";
import Copy from "lucide-solid/icons/copy";
import KeyRound from "lucide-solid/icons/key-round";
import Plus from "lucide-solid/icons/plus";
import Trash from "lucide-solid/icons/trash";
import { createMemo, createSignal, Show } from "solid-js";

import { ResponsiveTable } from "~/components/panel/responsive-table";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Dialog } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Segmented } from "~/components/ui/segmented";
import { Toolbar, ToolbarSearch, ToolbarSpacer } from "~/components/ui/toolbar";
import { keyStatusMeta } from "~/lib/panel-labels";
import { createClientResource } from "~/lib/resource";
import {
  createApiKey,
  deleteApiKey,
  emptyKeys,
  fetchApiKeys,
  type PanelApiKey,
} from "~/lib/user-panel";
import { formatDate, formatDateTime, formatRelativeTime, isExpired } from "~/lib/utils";

const STATUS_TABS = [
  { value: "all", label: "全部状态" },
  { value: "1", label: "启用" },
  { value: "0", label: "禁用" },
] as const;

type StatusFilter = (typeof STATUS_TABS)[number]["value"];

/** 密钥只回前后缀，中间固定用省略号：既认得出来，也不泄露 */
function maskedKey(key: PanelApiKey) {
  return key.key_suffix ? `${key.key_prefix}……${key.key_suffix}` : `${key.key_prefix}……`;
}

/**
 * 我的密钥。
 *
 * 两处跟「一个列表页」不一样的地方：
 *   - 明文只在创建后弹一次。创建成功之后不再回列表，直接把明文糊在弹窗里，
 *     让人当场复制走 —— 后端也只存哈希，关掉就真没了。
 *   - 过期的密钥单独标出来。过期了接口不报错、只是调用失败，不标的话很难查。
 *
 * 线上还有模型白名单、每分钟限速这些字段（接口里都有），本机先不做编辑入口。
 *
 * 数据来源是 GET /api/user/api_keys；新建与删除都真实落库，删完重新拉列表对齐。
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
      <Title>我的密钥 | TokenMP 用户面板</Title>

      <Show when={error()}>
        <p class="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive-text" role="alert">
          {error()}
        </p>
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

      {/* 明文只在这里出现一次 */}
      <Dialog
        open={created() !== null}
        onOpenChange={open => {
          if (!open) setCreated(null);
        }}
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
        </Show>
      </Dialog>
    </>
  );
}
