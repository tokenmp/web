import { Title } from "@solidjs/meta";
import Search from "lucide-solid/icons/search";
import { createEffect, createSignal, on, Show } from "solid-js";

import { CopyableId } from "~/components/panel/copyable-id";
import { DetailRow, MetricGrid } from "~/components/panel/detail-row";
import { ResponsiveTable } from "~/components/panel/responsive-table";
import { Section } from "~/components/panel/section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { PagerIfNeeded } from "~/components/ui/pager";
import { Segmented } from "~/components/ui/segmented";
import { Select } from "~/components/ui/select";
import { Sheet, SheetClose } from "~/components/ui/sheet";
import { requestStatusMeta } from "~/lib/panel-labels";
import { createClientResource } from "~/lib/resource";
import { getRequestRecordFilters, getRequestRecords, type RequestRecord } from "~/lib/usage";
import { formatDateTime, formatLatency, formatNumber, formatRelativeTime } from "~/lib/utils";

const PAGE_SIZE = 10;

const STATUS_TABS = [
  { value: "all", label: "全部" },
  { value: "success", label: "成功" },
  { value: "error", label: "失败" },
  { value: "in_progress", label: "请求中" },
] as const;

type StatusFilter = (typeof STATUS_TABS)[number]["value"];

/**
 * 请求日志。
 *
 * 排查用的一张表：哪次请求、走的谁、花了多久、成没成。
 * 详情里把失败信息摊开三层 —— 面板文案（给人看）、平台错误码（给平台看）、
 * 上游原文（给上游看），线上就是这么分的，少一层就得来回问。
 *
 * 线上的筛选是「模型 / UA 两个可搜索下拉 + 起止时间」，本机先用搜索框 + 状态分段：
 * 本机没有 Select 那个基础组件，为了两个筛选项引进来不划算，搜索框里也能打模型名。
 */
export default function PanelRequestRecords() {
  const [keyword, setKeyword] = createSignal("");
  const [model, setModel] = createSignal("all");
  const [status, setStatus] = createSignal<StatusFilter>("all");
  const [page, setPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal(PAGE_SIZE);

  const hasFilter = () => keyword().trim() !== "" || model() !== "all" || status() !== "all";

  // 列表在服务端筛选与分页，前端只负责把信号拼成查询参数
  const list = createClientResource(
    () =>
      getRequestRecords({
        page: page(),
        size: pageSize(),
        keyword: keyword().trim() || undefined,
        model: model() === "all" ? undefined : model(),
        status: status() === "all" ? undefined : status(),
      }),
    { items: [] as RequestRecord[], total: 0 },
  );

  const filters = createClientResource(getRequestRecordFilters, { models: [], user_agents: [] });

  // 筛选或页码一变就重新请求；首次挂载由 createClientResource 自己拉，defer 避免拉两次
  createEffect(
    on(
      () => [keyword(), model(), status(), page(), pageSize()],
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
    setPage(1);
  };

  return (
    <>
      <Title>请求日志 | TokenMP 用户面板</Title>


      <Card class="overflow-hidden">
        <div class="flex flex-wrap items-center gap-2 border-b p-4">
          <div class="relative w-full sm:w-80">
            <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              class="pl-8"
              placeholder="搜索模型 / 请求 ID / User Agent"
              aria-label="搜索请求记录"
              value={keyword()}
              onInput={event => {
                setKeyword(event.currentTarget.value);
                setPage(1);
              }}
            />
          </div>
          <Segmented
            options={STATUS_TABS}
            value={status()}
            onChange={value => {
              setStatus(value);
              setPage(1);
            }}
            ariaLabel="按状态筛选请求"
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
          <Button variant="outline" onClick={reset} class="lg:ml-auto">
            重置
          </Button>
        </div>

        <Show when={list.error()}>
          <p class="border-b bg-destructive/10 px-4 py-2.5 text-sm text-destructive-text" role="alert">
            {list.error()}
          </p>
        </Show>

        <ResponsiveTable
          items={list.data().items}
          rowKey={record => record.request_id}
          minWidth="min-w-[980px]"
          columns={[
            {
              header: "模型",
              cell: record => (
                <div>
                  <p class="font-medium">{record.model}</p>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    {record.channel}
                    {record.served_model ? ` · 实际 ${record.served_model}` : ""}
                  </p>
                </div>
              ),
            },
            { header: "协议", cell: record => record.entry },
            { header: "流式", cell: record => (record.stream ? "流式" : "非流式") },
            {
              header: "思考",
              cell: record => record.reasoning_effort ?? <span class="text-muted-foreground">—</span>,
            },
            {
              header: "总耗时",
              cell: record => (
                <span class="tabular-nums">
                  {record.latency_ms ? formatLatency(record.latency_ms) : "—"}
                </span>
              ),
            },
            {
              header: "状态",
              cell: record => (
                <Badge variant={requestStatusMeta(record.status).variant}>
                  {requestStatusMeta(record.status).label}
                </Badge>
              ),
            },
            {
              header: "时间",
              cell: record => (
                <span class="text-muted-foreground" title={formatDateTime(record.created_at)}>
                  {formatRelativeTime(record.created_at)}
                </span>
              ),
            },
          ]}
          cardTitle={record => record.model ?? "未知模型"}
          cardSubtitle={record =>
            `${record.channel ?? "未知渠道"} · ${record.total_tokens ? `${formatNumber(record.total_tokens)} tok · ` : ""}${formatRelativeTime(record.created_at)}`
          }
          cardRight={record => (
            <Badge variant={requestStatusMeta(record.status).variant}>
              {requestStatusMeta(record.status).label}
            </Badge>
          )}
          actions={record => (
            <Sheet
              trigger="请求详情"
              title={record.model ?? "未知模型"}
              description={`${record.channel ?? "未知渠道"} · ${formatDateTime(record.created_at)}`}
              footer={<SheetClose>关闭</SheetClose>}
            >
              <RecordDetail record={record} />
            </Sheet>
          )}
          empty={hasFilter() ? "没有匹配的记录" : "暂无请求记录"}
          emptyDescription={hasFilter() ? "试试调整搜索词或筛选条件" : "还没有产生过 API 调用"}
        />

        <div class="px-5">
          <PagerIfNeeded
            page={page()}
            size={pageSize()}
            total={list.data().total}
            onPageChange={setPage}
            onSizeChange={value => {
              setPageSize(value);
              setPage(1);
            }}
          />
        </div>
      </Card>
    </>
  );
}

/** 延迟这类可能没有的指标：没有就显示一个破折号，别显示 NaN */
function latency(ms: number | null | undefined) {
  return ms ? formatLatency(ms) : "—";
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
    {
      label: "延迟",
      value: record().latency_ms ? formatLatency(record().latency_ms!) : "—",
    },
    { label: "首字", value: record().ttfb_ms ? formatLatency(record().ttfb_ms!) : "—" },
    { label: "速率", value: record().tps ? `${record().tps} tok/s` : "—" },
  ];

  return (
    <div class="space-y-5">
      <div class="flex flex-wrap items-center gap-2">
        <Badge variant={requestStatusMeta(record().status).variant}>
          {requestStatusMeta(record().status).label}
        </Badge>
        <Badge variant="secondary">{record().entry}</Badge>
        <Badge variant="secondary">{record().stream ? "流式" : "非流式"}</Badge>
        {record().retried && <Badge variant="warning">已重试</Badge>}
      </div>

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
          <DetailRow label="模型" value={record().model} />
          <DetailRow label="渠道" value={record().channel} />
          <DetailRow label="User Agent" value={record().user_agent ?? "—"} />
          <DetailRow
            label="尝试"
            value={record().attempts && record().attempts! > 1 ? `${record().attempts} 次（已重试）` : "1 次"}
          />
          <DetailRow label="记录时间" value={formatDateTime(record().created_at)} />
        </dl>
      </Section>
    </div>
  );
}

