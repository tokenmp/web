import { Title } from "@solidjs/meta";
import { createEffect, createSignal, For, on, Show } from "solid-js";

import { PageHeader, StatRow } from "~/components/layout/page-header";
import { CopyableId } from "~/components/panel/copyable-id";
import { DetailRow, MetricGrid } from "~/components/panel/detail-row";
import { Section } from "~/components/panel/section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ErrorState } from "~/components/ui/error-state";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { PagerIfNeeded } from "~/components/ui/pager";
import { Segmented } from "~/components/ui/segmented";
import { Select } from "~/components/ui/select";
import { Sheet, SheetClose } from "~/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { requestStatusMeta } from "~/lib/panel-labels";
import { createClientResource } from "~/lib/resource";
import {
  getAdminRequestRecordFilters,
  getAdminRequestRecords,
  type RequestRecord,
} from "~/lib/usage";
import { formatDateTime, formatLatency, formatNumber } from "~/lib/utils";

const SIZE = 20;

const STATUS_TABS = [
  { value: "all", label: "全部" },
  { value: "success", label: "成功" },
  { value: "error", label: "失败" },
  { value: "in_progress", label: "请求中" },
] as const;

type StatusFilter = (typeof STATUS_TABS)[number]["value"];

/**
 * datetime-local 的值转 ISO；空值或非法值返回 undefined，交给后端忽略。
 *
 * 输入只精确到分钟，而 `end` 在服务端是闭区间（`lte`）：直接转成 12:00:00.000
 * 会漏掉这一分钟里 12:00:00–12:00:59 的调用记录。填「12:00」的意思是「到 12:00 为止」，
 * 所以要补到这一分钟的最后一毫秒。与充值单页同一个口径。
 */
function toIso(value: string, edge: "start" | "end" = "start") {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  if (edge === "end" && !/:\d{2}:\d{2}/.test(value)) date.setSeconds(59, 999);
  return date.toISOString();
}

/**
 * 控制台调用记录。
 *
 * 与用户面板那一页是同一张表的两个视角：面板按 user_id 收窄到自己，这里不传就
 * 是全站，并多出按用户、模型、状态、时间范围筛选。排查「某个用户某段时间为什么一直失败」
 * 就从这一页进：先按 user_id 与时间收窄，再按状态分段挑出失败的。
 *
 * 数据源是转发内核回写的 request_records，网关没接上之前是空列表，页面用空状态撑住。
 */
export default function DashboardRequestRecords() {
  const [page, setPage] = createSignal(1);
  const [size, setSize] = createSignal(SIZE);

  // 输入控件绑定的即时值
  const [keyword, setKeyword] = createSignal("");
  const [model, setModel] = createSignal("all");
  const [status, setStatus] = createSignal<StatusFilter>("all");
  const [userId, setUserId] = createSignal("");
  const [start, setStart] = createSignal("");
  const [end, setEnd] = createSignal("");

  /** 当前看详情的那一条。抽屉挂在页面这一层，不在表格里 */
  const [detail, setDetail] = createSignal<RequestRecord | null>(null);

  const hasFilter = () =>
    keyword().trim() !== "" ||
    model() !== "all" ||
    status() !== "all" ||
    userId().trim() !== "" ||
    start() !== "" ||
    end() !== "";

  const list = createClientResource(
    () =>
      getAdminRequestRecords({
        page: page(),
        size: size(),
        keyword: keyword().trim() || undefined,
        user_id: userId().trim() ? Number(userId().trim()) || undefined : undefined,
        model: model() === "all" ? undefined : model(),
        status: status() === "all" ? undefined : status(),
        start: toIso(start()),
        end: toIso(end(), "end"),
      }),
    { items: [] as RequestRecord[], total: 0 },
  );

  const filters = createClientResource(getAdminRequestRecordFilters, {
    models: [],
    user_agents: [],
  });

  // 筛选或页码一变重新请求。首次挂载由 createClientResource 自己拉，defer 避免拉两次
  createEffect(
    on(
      () => [keyword(), model(), status(), userId(), start(), end(), page(), size()],
      () => {
        void list.reload();
      },
      { defer: true },
    ),
  );

  const modelOptions = () => [
    { value: "all", label: "全部模型" },
    ...filters.data().models.map(value => ({ value, label: value })),
  ];

  const reset = () => {
    setKeyword("");
    setModel("all");
    setStatus("all");
    setUserId("");
    setStart("");
    setEnd("");
    setPage(1);
    void list.reload();
  };

  // 概览只统计本页与前两个筛选条件：分页接口只回一页的 items 与总数，
  // 没有全量聚合，所以逐项写「本页」，不假装是全站数字
  const stats = () => {
    const items = list.data().items;
    return [
      { label: "匹配记录", value: formatNumber(list.data().total), hint: "按当前筛选条件" },
      {
        label: "本页失败",
        value: formatNumber(items.filter(item => item.status === "error").length),
        hint: "含上游报错与超时",
      },
      {
        label: "本页请求中",
        value: formatNumber(items.filter(item => item.status === "in_progress").length),
        hint: "还没收到结束回写",
      },
      {
        label: "本页用量",
        value: formatNumber(items.reduce((sum, item) => sum + item.total_tokens, 0)),
        hint: "输入与输出合计",
      },
    ];
  };

  return (
    <>
      <Title>调用记录 | tokenmp web</Title>

      <PageHeader description="全站的调用记录，数据来自转发内核回写。">
        <Button variant="outline" onClick={() => void list.reload()}>
          刷新
        </Button>
      </PageHeader>

      <StatRow items={stats()} />

      <Card class="overflow-hidden">
        {/* 多字段筛选，不是一行工具条：标签画在控件上方，与充值单页、调账记录同一套写法 */}
        <div class="space-y-3 border-b px-4 py-3">
          <div class="flex flex-wrap items-center gap-2">
            <Segmented
              options={STATUS_TABS}
              value={status()}
              onChange={value => {
                setStatus(value);
                setPage(1);
              }}
              ariaLabel="按状态筛选调用记录"
            />
            <Select
              label="模型"
              labelPlacement="inline"
              class="w-full sm:w-44"
              options={modelOptions()}
              value={model()}
              onChange={value => {
                setModel(value);
                setPage(1);
              }}
            />
          </div>

          <form
            class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={event => {
              event.preventDefault();
              setPage(1);
              void list.reload();
            }}
          >
            <div class="space-y-1.5">
              <Label for="records-keyword">关键字</Label>
              <Input
                id="records-keyword"
                placeholder="模型 / 请求 ID / User Agent"
                value={keyword()}
                onInput={event => {
                  setKeyword(event.currentTarget.value);
                  setPage(1);
                }}
              />
            </div>
            <div class="space-y-1.5">
              <Label for="records-user">用户 ID</Label>
              <Input
                id="records-user"
                inputmode="numeric"
                placeholder="精确匹配"
                value={userId()}
                onInput={event => {
                  setUserId(event.currentTarget.value);
                  setPage(1);
                }}
              />
            </div>
            <div class="space-y-1.5">
              <Label for="records-start">开始时间</Label>
              <Input
                id="records-start"
                type="datetime-local"
                value={start()}
                onInput={event => {
                  setStart(event.currentTarget.value);
                  setPage(1);
                }}
              />
            </div>
            <div class="space-y-1.5">
              <Label for="records-end">结束时间</Label>
              <Input
                id="records-end"
                type="datetime-local"
                value={end()}
                onInput={event => {
                  setEnd(event.currentTarget.value);
                  setPage(1);
                }}
              />
            </div>
            <div class="flex items-end gap-2 lg:col-span-4">
              <Button type="submit">查询</Button>
              {/* 在 <form> 里按钮默认是 submit，重置要显式写成 button */}
              <Button type="button" variant="outline" onClick={reset}>
                重置
              </Button>
            </div>
          </form>

          {/* 模型下拉的选项来自服务端聚合。它挂了不影响上面的输入框，只是选不了具体模型，
              单独说一句，别让人以为模型就那么几个 */}
          <Show when={filters.error()}>
            <p class="text-sm text-destructive-text" role="alert">
              模型名单读取失败，下拉里只剩「全部模型」：{filters.error()}
            </p>
          </Show>
        </div>

        <Show when={list.error()}>
          <ErrorState
            variant="inline"
            class="border-b px-4"
            message={list.error()!}
            onRetry={() => void list.reload()}
          />
        </Show>

        <Table class="border-b" tableClass="min-w-[1040px]">
          <TableHeader>
            <TableRow>
              <TableHead>模型</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>协议</TableHead>
              <TableHead>流式</TableHead>
              <TableHead class="text-right">用量</TableHead>
              <TableHead class="text-right">总耗时</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>时间</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={list.data().items}>
              {record => (
                <TableRow>
                  <TableCell>
                    <p class="font-medium">{record.model ?? "—"}</p>
                    <p class="mt-0.5 text-xs text-muted-foreground">
                      {record.channel ?? "未知渠道"}
                      {record.served_model ? ` · 实际 ${record.served_model}` : ""}
                    </p>
                  </TableCell>
                  {/* 这一页是全站的，用户是谁必须列出来；记录里的 user_id 可能为空
                      （调用没带客户端密钥就落不下来人），空值写破折号 */}
                  <TableCell class="tabular-nums text-muted-foreground">
                    {record.user_id === null ? "—" : `#${record.user_id}`}
                  </TableCell>
                  <TableCell class="text-muted-foreground">{record.entry ?? "—"}</TableCell>
                  <TableCell class="text-muted-foreground">
                    {record.stream ? "流式" : "非流式"}
                  </TableCell>
                  <TableCell class="text-right tabular-nums text-muted-foreground">
                    {formatNumber(record.total_tokens)}
                  </TableCell>
                  <TableCell class="text-right tabular-nums">
                    {record.latency_ms ? formatLatency(record.latency_ms) : "—"}
                  </TableCell>
                  <TableCell>
                    <div class="flex flex-wrap items-center gap-1.5">
                      <Badge variant={requestStatusMeta(record.status).variant}>
                        {requestStatusMeta(record.status).label}
                      </Badge>
                      <Show when={record.retried}>
                        <Badge variant="warning">已重试</Badge>
                      </Show>
                    </div>
                  </TableCell>
                  <TableCell class="tabular-nums text-muted-foreground">
                    {formatDateTime(record.created_at)}
                  </TableCell>
                  <TableCell class="text-right">
                    <Button variant="outline" onClick={() => setDetail(record)}>
                      请求详情
                    </Button>
                  </TableCell>
                </TableRow>
              )}
            </For>

            <Show when={list.data().items.length === 0}>
              <TableRow>
                <TableCell class="py-10 text-center text-muted-foreground" colSpan={9}>
                  {list.loading()
                    ? "正在加载…"
                    : hasFilter()
                      ? "没有匹配的调用记录"
                      : "还没有调用记录"}
                </TableCell>
              </TableRow>
            </Show>
          </TableBody>
        </Table>

        <PagerIfNeeded
          page={page()}
          size={size()}
          total={list.data().total}
          onPageChange={setPage}
          onSizeChange={value => {
            setSize(value);
            setPage(1);
          }}
        />
      </Card>

      <Sheet
        open={detail() !== null}
        onOpenChange={open => !open && setDetail(null)}
        title={detail()?.model ?? "未知模型"}
        description={
          detail()
            ? `${detail()!.channel ?? "未知渠道"} · ${formatDateTime(detail()!.created_at)}`
            : undefined
        }
        footer={<SheetClose>关闭</SheetClose>}
      >
        <Show when={detail()}>{record => <RecordDetail record={record()} />}</Show>
      </Sheet>
    </>
  );
}

/** 详情抽屉：状态头 + 用量指标 + 标识时间，失败时补一段错误信息 */
function RecordDetail(props: { record: RequestRecord }) {
  const record = () => props.record;

  const metrics = () => [
    { label: "Token 合计", value: formatNumber(record().total_tokens) },
    { label: "输入", value: formatNumber(record().prompt_tokens) },
    { label: "输出", value: formatNumber(record().completion_tokens) },
    { label: "缓存读", value: formatNumber(record().cache_read_tokens) },
    { label: "缓存写", value: formatNumber(record().cache_write_tokens) },
    { label: "延迟", value: record().latency_ms ? formatLatency(record().latency_ms!) : "—" },
    { label: "首字", value: record().ttfb_ms ? formatLatency(record().ttfb_ms!) : "—" },
    { label: "速率", value: record().tps ? `${record().tps} tok/s` : "—" },
  ];

  return (
    <div class="space-y-5">
      <div class="flex flex-wrap items-center gap-2">
        <Badge variant={requestStatusMeta(record().status).variant}>
          {requestStatusMeta(record().status).label}
        </Badge>
        <Badge variant="secondary">{record().entry ?? "未知协议"}</Badge>
        <Badge variant="secondary">{record().stream ? "流式" : "非流式"}</Badge>
        <Show when={record().retried}>
          <Badge variant="warning">已重试</Badge>
        </Show>
      </div>

      {/* 失败信息摊开三层：面板文案（给人看）、错误码与 HTTP 状态（给平台看）、
          上游原文（给上游看）。少一层就得来回问 */}
      <Show when={record().status === "error"}>
        <section class="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <h3 class="text-sm font-medium text-destructive-text">失败原因</h3>
          <p class="mt-1 text-sm text-destructive-text">
            {record().panel_message ?? "调用失败，请稍后重试"}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            错误码 {record().error_code ?? "—"}
            {record().http_status ? ` · HTTP ${record().http_status}` : ""}
          </p>
          <Show when={record().error_message}>
            <p class="mt-2 break-words border-l-2 border-destructive/40 pl-2 font-mono text-[11px] text-muted-foreground">
              {record().error_message}
            </p>
          </Show>
        </section>
      </Show>

      <Section title="用量与指标">
        <MetricGrid items={metrics()} />
      </Section>

      <Section title="标识与时间">
        <dl class="space-y-2.5 text-sm">
          <DetailRow label="请求 ID" value={<CopyableId value={record().request_id} />} />
          <DetailRow
            label="用户"
            value={record().user_id === null ? "—" : `#${record().user_id}`}
          />
          <DetailRow
            label="客户端密钥"
            value={record().api_key_id === null ? "—" : `#${record().api_key_id}`}
          />
          <DetailRow label="模型" value={record().model ?? "—"} />
          <DetailRow label="实际模型" value={record().served_model ?? "—"} />
          <DetailRow label="渠道" value={record().channel ?? "—"} />
          <DetailRow label="上游地址" value={record().base_url ?? "—"} />
          <DetailRow label="User Agent" value={record().user_agent ?? "—"} />
          <DetailRow
            label="尝试"
            value={
              record().attempts && record().attempts! > 1
                ? `${record().attempts} 次（已重试）`
                : "1 次"
            }
          />
          <DetailRow label="记录时间" value={formatDateTime(record().created_at)} />
        </dl>
      </Section>
    </div>
  );
}
