import { Title } from "@solidjs/meta";
import Plus from "lucide-solid/icons/plus";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import Search from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import { createMemo, createSignal, For, Show } from "solid-js";

import { PageHeader } from "~/components/layout/page-header";
import { ResponsiveTable } from "~/components/panel/responsive-table";
import { Section } from "~/components/panel/section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Dialog } from "~/components/ui/dialog";
import { EmptyState } from "~/components/ui/empty-state";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Segmented } from "~/components/ui/segmented";
import {
  accountGroups,
  catalogModels,
  channelApplications,
  type AccountGroup,
  type ChannelApplication,
} from "~/lib/panel-data";
import { appStatusMeta } from "~/lib/panel-labels";
import { cn, formatDateTime, formatNumber } from "~/lib/utils";

const TYPE_OPTIONS: { value: "openai" | "anthropic"; label: string }[] = [
  { value: "openai", label: "OpenAI 兼容" },
  { value: "anthropic", label: "Anthropic" },
];

const PLATFORM_MODELS = catalogModels.map(model => model.model);

/**
 * 我的渠道。
 *
 * 两段：已经批下来的渠道组（可编辑、可重推网关），以及还在走的申请单。
 * 提交申请时只填连通信息 —— 成本、售价、分成比例都由平台统一管，
 * 用户填了也没意义，反而会误导。
 *
 * 模型清单用一个能敲回车的标签输入：先拉上游模型列表的是平台那边的事，
 * 这边至少要能手动写几个。
 */
export default function PanelChannels() {
  const [groups, setGroups] = createSignal<AccountGroup[]>(
    accountGroups.filter(group => group.owned_by_me),
  );
  const [applications, setApplications] = createSignal<ChannelApplication[]>(channelApplications);
  const [keyword, setKeyword] = createSignal("");
  const [showApplications, setShowApplications] = createSignal(true);
  const [hint, setHint] = createSignal("");

  const [formOpen, setFormOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<AccountGroup | null>(null);
  const [name, setName] = createSignal("");
  const [type, setType] = createSignal<"openai" | "anthropic">("openai");
  const [baseUrl, setBaseUrl] = createSignal("");
  const [apiKey, setApiKey] = createSignal("");
  const [models, setModels] = createSignal<string[]>([]);
  const [modelDraft, setModelDraft] = createSignal("");
  const [notice, setNotice] = createSignal("");

  const [pendingCancel, setPendingCancel] = createSignal<ChannelApplication | null>(null);

  const query = () => keyword().trim().toLowerCase();

  const filteredGroups = createMemo(() =>
    groups().filter(group => group.name.toLowerCase().includes(query())),
  );
  const filteredApplications = createMemo(() =>
    applications().filter(
      application =>
        application.name.toLowerCase().includes(query()) ||
        application.status.toLowerCase().includes(query()),
    ),
  );

  const openForm = (group: AccountGroup | null) => {
    setEditing(group);
    setName(group?.name ?? "");
    setType(group?.type === "anthropic" ? "anthropic" : "openai");
    setBaseUrl(group?.base_url ?? "");
    setApiKey("");
    setModels(group?.models ?? []);
    setModelDraft("");
    setNotice("");
    setFormOpen(true);
  };

  const addModel = (value: string) => {
    const model = value.trim();
    if (!model || models().includes(model)) return;
    setModels(prev => [...prev, model]);
    setModelDraft("");
  };

  const submit = () => {
    if (!name().trim()) {
      setNotice("请填写名称");
      return;
    }
    if (!baseUrl().trim()) {
      setNotice("请填写 Base URL");
      return;
    }
    if (!editing() && !apiKey().trim()) {
      setNotice("请填写 API Key");
      return;
    }
    if (models().length === 0) {
      setNotice("至少填写 1 个模型");
      return;
    }

    // 示例数据：编辑走 PUT /user/channel-groups/{id}，新建走 POST /user/channel-applications
    if (editing()) {
      setGroups(prev =>
        prev.map(group =>
          group.id === editing()!.id
            ? { ...group, name: name().trim(), type: type(), base_url: baseUrl().trim(), models: models() }
            : group,
        ),
      );
      setHint("已保存并重新下发网关");
    } else {
      setApplications(prev => [
        {
          id: 30 + prev.length + 1,
          applicant_user_id: 263,
          name: name().trim(),
          type: type(),
          base_url: baseUrl().trim(),
          models: models(),
          share_rate: null,
          status: "pending",
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
      setHint("已提交，等待管理员审核");
      setShowApplications(true);
    }

    setFormOpen(false);
    window.setTimeout(() => setHint(""), 3000);
  };

  const cancelApplication = () => {
    const target = pendingCancel();
    if (!target) return;
    setApplications(prev => prev.filter(application => application.id !== target.id));
    setPendingCancel(null);
    setHint("申请已撤销");
    window.setTimeout(() => setHint(""), 3000);
  };

  return (
    <>
      <Title>我的渠道 | TokenMP 用户面板</Title>

      <PageHeader description="我提供的分享渠道：申请与渠道组管理">
        <Button onClick={() => openForm(null)}>
          <Plus class="size-4" aria-hidden="true" />
          提交申请
        </Button>
      </PageHeader>

      <Show when={hint()}>
        <p class="mb-4 rounded-lg border border-success/30 bg-success/15 px-4 py-2.5 text-sm text-success-text">
          {hint()}
        </p>
      </Show>

      <Card class="overflow-hidden">
        <div class="flex flex-wrap items-center gap-2 border-b p-4">
          <h2 class="text-sm font-semibold">我的渠道组</h2>
          <p class="text-xs text-muted-foreground">申请通过后生成，编辑保存后会重新下发网关</p>
          <div class="relative w-full sm:w-64 lg:ml-auto">
            <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              class="pl-8"
              placeholder="搜索渠道组与申请名称"
              aria-label="搜索渠道组"
              value={keyword()}
              onInput={event => setKeyword(event.currentTarget.value)}
            />
          </div>
        </div>

        <ResponsiveTable
          items={filteredGroups()}
          rowKey={group => group.id}
          minWidth="min-w-[900px]"
          columns={[
            {
              header: "名称",
              cell: group => (
                <div>
                  <p class="font-medium">{group.name}</p>
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
                  <For each={group.models}>{model => <Badge variant="secondary">{model}</Badge>}</For>
                </div>
              ),
            },
            {
              header: "账号数",
              align: "right",
              cell: group => <span class="tabular-nums">{formatNumber(group.account_count)}</span>,
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
            <div class="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-label={`编辑渠道组：${group.name}`}
                onClick={() => openForm(group)}
              >
                编辑
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`重新下发网关：${group.name}`}
                onClick={() => {
                  setHint("已保存并重新下发网关");
                  window.setTimeout(() => setHint(""), 3000);
                }}
              >
                <RefreshCw class="size-3.5" aria-hidden="true" />
                同步
              </Button>
            </div>
          )}
          empty={query() ? "没有匹配的渠道组" : "暂无渠道组"}
          emptyDescription={query() ? "试试调整搜索词" : "提交分享申请，管理员审核通过后生成"}
        />
      </Card>

      <Card class="mt-5 overflow-hidden">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b p-4">
          <div>
            <h2 class="text-sm font-semibold">
              申请记录
              <span class="ml-2 text-xs font-normal text-muted-foreground">
                共 {formatNumber(applications().length)} 条
              </span>
            </h2>
            <p class="mt-1 text-xs text-muted-foreground">
              提交分享渠道申请，管理员审核通过后生效
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={showApplications()}
            onClick={() => setShowApplications(value => !value)}
          >
            {showApplications() ? "收起申请记录" : "展开申请记录"}
          </Button>
        </div>

        <Show when={showApplications()}>
          <ResponsiveTable
            items={filteredApplications()}
            rowKey={application => application.id}
            minWidth="min-w-[900px]"
            columns={[
              {
                header: "名称",
                cell: application => (
                  <div>
                    <p class="font-medium">{application.name}</p>
                    <p class="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                      {application.base_url}
                    </p>
                  </div>
                ),
              },
              {
                header: "模型",
                cell: application => (
                  <div class="flex flex-wrap gap-1">
                    <For each={application.models}>
                      {model => <Badge variant="secondary">{model}</Badge>}
                    </For>
                  </div>
                ),
              },
              {
                header: "提交时间",
                cell: application => (
                  <span class="tabular-nums text-muted-foreground">
                    {formatDateTime(application.created_at)}
                  </span>
                ),
              },
              {
                header: "状态",
                cell: application => (
                  <Badge variant={appStatusMeta(application.status).variant}>
                    {appStatusMeta(application.status).label}
                  </Badge>
                ),
              },
              {
                header: "备注",
                cell: application => (
                  <span class="text-xs text-muted-foreground">
                    {application.admin_note ??
                      (application.status === "pending" ? "等待管理员审核" : "—")}
                  </span>
                ),
              },
            ]}
            cardTitle={application => application.name}
            cardSubtitle={application =>
              `${application.models.join("、")} · ${formatDateTime(application.created_at)}`
            }
            cardRight={application => (
              <Badge variant={appStatusMeta(application.status).variant}>
                {appStatusMeta(application.status).label}
              </Badge>
            )}
            actions={application => (
              <Show when={application.status === "pending"}>
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-destructive-text"
                  aria-label={`撤销申请：${application.name}`}
                  onClick={() => setPendingCancel(application)}
                >
                  撤销
                </Button>
              </Show>
            )}
            empty={query() ? "没有匹配的申请" : "还没有分享申请"}
            emptyDescription={
              query() ? "试试调整搜索词" : "提交申请，管理员审核通过后即可对外提供分享"
            }
          />
        </Show>
      </Card>

      {/* 提交申请 / 编辑渠道组 */}
      <Dialog
        open={formOpen()}
        onOpenChange={setFormOpen}
        title={editing() ? "编辑分享渠道" : "提交分享渠道申请"}
        description={
          editing()
            ? "保存后立即生效并重新下发网关；名称与分成比例由平台管理"
            : "填写渠道连通信息，管理员审核通过后生效。成本与售价由平台统一管理"
        }
        class="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button onClick={submit}>{editing() ? "保存并下发" : "提交申请"}</Button>
          </>
        }
      >
        <div class="space-y-4">
          <div class="space-y-1.5">
            <Label for="channel-name">名称</Label>
            <Input
              id="channel-name"
              value={name()}
              placeholder="如 我的开源中转"
              onInput={event => setName(event.currentTarget.value)}
            />
          </div>

          <div class="space-y-1.5">
            <Label>类型</Label>
            <Segmented options={TYPE_OPTIONS} value={type()} onChange={setType} ariaLabel="渠道类型" />
          </div>

          <div class="space-y-1.5">
            <Label for="channel-base">Base URL</Label>
            <Input
              id="channel-base"
              class="font-mono text-xs"
              value={baseUrl()}
              placeholder="https://api.example.com"
              onInput={event => setBaseUrl(event.currentTarget.value)}
            />
          </div>

          <Show when={!editing()}>
            <div class="space-y-1.5">
              <Label for="channel-key">API Key（必填，加密存储）</Label>
              <Input
                id="channel-key"
                type="password"
                class="font-mono text-xs"
                value={apiKey()}
                placeholder="sk-…"
                onInput={event => setApiKey(event.currentTarget.value)}
              />
              <p class="text-xs text-muted-foreground">
                只用于探测与转发，提交后任何接口都不会回显。
              </p>
            </div>
          </Show>

          <div class="space-y-1.5">
            <Label for="channel-models">可用模型（至少 1 个）</Label>
            <Show when={models().length > 0}>
              <div class="flex flex-wrap gap-1.5">
                <For each={models()}>
                  {model => (
                    <span class="inline-flex items-center gap-1 rounded-md border bg-secondary px-2 py-0.5 text-xs">
                      {model}
                      <button
                        type="button"
                        aria-label={`移除模型 ${model}`}
                        class="rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        onClick={() => setModels(prev => prev.filter(item => item !== model))}
                      >
                        <X class="size-3" aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </For>
              </div>
            </Show>
            <Input
              id="channel-models"
              value={modelDraft()}
              placeholder="输入模型名后回车添加"
              onInput={event => setModelDraft(event.currentTarget.value)}
              onKeyDown={event => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addModel(modelDraft());
              }}
            />
            <div class="flex flex-wrap gap-1.5 pt-1">
              <For each={PLATFORM_MODELS.filter(item => !models().includes(item))}>
                {model => (
                  <button
                    type="button"
                    onClick={() => addModel(model)}
                    class={cn(
                      "rounded-md border px-2 py-0.5 text-xs text-muted-foreground transition-colors",
                      "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    )}
                  >
                    + {model}
                  </button>
                )}
              </For>
            </div>
          </div>

          <Show when={notice()}>
            <p class="text-sm text-destructive-text" role="alert">
              {notice()}
            </p>
          </Show>

          <p class="text-xs text-muted-foreground">
            他人使用本渠道时，你会按平台的模型分成率获得积分；本机是示例数据，提交不会真的落库。
          </p>
        </div>
      </Dialog>

      <Dialog
        open={pendingCancel() !== null}
        onOpenChange={open => {
          if (!open) setPendingCancel(null);
        }}
        title="撤销申请？"
        description="撤销后该申请将被删除，可以重新提交。"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingCancel(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={cancelApplication}>
              撤销
            </Button>
          </>
        }
      />

      <Section title="说明" class="mt-5">
        <ul class="space-y-1.5 text-xs text-muted-foreground">
          <li>· 分享渠道的成本与售价由平台统一管理，你只需要提供连通信息与模型清单。</li>
          <li>· 审核通过后生成的渠道组会出现在「我的账号」里，可以往上挂账号。</li>
          <li>· 编辑渠道组会立即重新下发网关，正在进行的请求不受影响。</li>
        </ul>
      </Section>
    </>
  );
}
