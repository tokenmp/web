import { Title } from "@solidjs/meta";
import Search from "lucide-solid/icons/search";
import { createMemo, createSignal, Show } from "solid-js";

import { PageHeader } from "~/components/layout/page-header";
import { CopyableId } from "~/components/panel/copyable-id";
import { DetailRow, MetricGrid } from "~/components/panel/detail-row";
import { ResponsiveTable } from "~/components/panel/responsive-table";
import { Section } from "~/components/panel/section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { DecimalSplit } from "~/components/ui/decimal-split";
import { Input } from "~/components/ui/input";
import { PagerIfNeeded } from "~/components/ui/pager";
import { Segmented } from "~/components/ui/segmented";
import { Select } from "~/components/ui/select";
import { Sheet, SheetClose } from "~/components/ui/sheet";
import { billingRecords, type BillingRecord } from "~/lib/panel-data";
import { billingStatusMeta, ledgerMeta } from "~/lib/panel-labels";
import { formatDateTime, formatLatency, formatNumber, formatPoints, formatRelativeTime } from "~/lib/utils";

const PAGE_SIZE = 10;

const MODEL_OPTIONS = [
  { value: "all", label: "全部模型" },
  ...[...new Set(billingRecords.map(record => record.model))]
    .sort()
    .map(model => ({ value: model, label: model })),
];

const LEDGER_TABS = [
  { value: "all", label: "全部扣费" },
  { value: "quota", label: "订阅额度" },
  { value: "balance", label: "余额" },
] as const;

const STATUS_TABS = [
  { value: "all", label: "全部" },
  { value: "success", label: "成功" },
  { value: "error", label: "失败" },
] as const;

type LedgerFilter = (typeof LEDGER_TABS)[number]["value"];
type StatusFilter = (typeof STATUS_TABS)[number]["value"];

/**
 * 账单流水。
 *
 * 跟请求日志同源，但看的是钱：这次扣了多少、扣的是订阅额度还是余额、
 * 平台成本与我的实付各是多少。上表是明细，抽屉里摊开用量与计费两段，
 * 底部给一段合计 —— 用户来这张表多半是想知道「这个月花在哪了」。
 */
export default function PanelBilling() {
  const [keyword, setKeyword] = createSignal("");
  const [model, setModel] = createSignal("all");
  const [status, setStatus] = createSignal<StatusFilter>("all");
  const [ledger, setLedger] = createSignal<LedgerFilter>("all");
  const [page, setPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal(PAGE_SIZE);

  const filtered = createMemo(() => {
    const query = keyword().trim().toLowerCase();
    return billingRecords.filter(record => {
      const matchStatus = status() === "all" || record.status === status();
      const matchLedger = ledger() === "all" || record.ledger === ledger();
      const matchModel = model() === "all" || record.model === model();
      const matchQuery =
        query === "" ||
        record.request_id.toLowerCase().includes(query) ||
        record.model.toLowerCase().includes(query);
      return matchStatus && matchLedger && matchModel && matchQuery;
    });
  });

  const paged = createMemo(() => filtered().slice((page() - 1) * pageSize(), page() * pageSize()));
  const revenueTotal = () =>
    filtered().reduce((sum, record) => sum + record.revenue_amount, 0);

  const reset = () => {
    setKeyword("");
    setModel("all");
    setStatus("all");
    setLedger("all");
    setPage(1);
  };

  return (
    <>
      <Title>账单流水 | TokenMP 用户面板</Title>

      <PageHeader description="按状态、扣费与模型筛选调用记录与计费明细" />

      <Card class="overflow-hidden">
        <div class="flex flex-wrap items-center gap-2 border-b p-4">
          <div class="relative w-full sm:w-72">
            <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              class="pl-8"
              placeholder="搜索请求 ID / 模型"
              aria-label="搜索账单流水"
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
            ariaLabel="按状态筛选"
          />
          <Segmented
            options={LEDGER_TABS}
            value={ledger()}
            onChange={value => {
              setLedger(value);
              setPage(1);
            }}
            ariaLabel="按扣费方式筛选"
          />
          <Select
            label="模型"
            labelPlacement="inline"
            class="w-full sm:w-44"
            options={MODEL_OPTIONS}
            value={model()}
            onChange={value => {
              setModel(value);
              setPage(1);
            }}
          />
          <Button variant="outline" class="lg:ml-auto" onClick={reset}>
            重置
          </Button>
        </div>

        <ResponsiveTable
          items={paged()}
          rowKey={record => record.id}
          minWidth="min-w-[960px]"
          columns={[
            {
              header: "模型",
              cell: record => (
                <div>
                  <p class="font-medium">{record.model}</p>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    {record.channel_name} · {record.stream ? "流式" : "非流式"}
                  </p>
                </div>
              ),
            },
            {
              header: "状态",
              cell: record => (
                <Badge variant={billingStatusMeta(record.status).variant}>
                  {billingStatusMeta(record.status).label}
                </Badge>
              ),
            },
            {
              header: "支付",
              cell: record => (
                <Badge variant={ledgerMeta(record.ledger).variant}>
                  {ledgerMeta(record.ledger).label}
                </Badge>
              ),
            },
            {
              header: "成本（积分）",
              align: "right",
              cell: record => (
                <span class="text-muted-foreground">
                  <DecimalSplit text={formatPoints(record.cost_amount)} />
                </span>
              ),
            },
            {
              header: "收入（积分）",
              align: "right",
              cell: record => <DecimalSplit text={formatPoints(record.revenue_amount)} />,
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
          cardTitle={record => record.model}
          cardSubtitle={record =>
            `${ledgerMeta(record.ledger).label} · ${formatNumber(record.total_tokens)} tok · ${formatRelativeTime(record.created_at)}`
          }
          cardRight={record => (
            <span class="text-right">
              <DecimalSplit text={formatPoints(record.revenue_amount)} />
              <span class="block text-[11px] text-muted-foreground">积分</span>
            </span>
          )}
          actions={record => (
            <Sheet
              trigger="流水详情"
              title={record.model}
              description={`${record.request_id} · ${formatDateTime(record.created_at)}`}
              footer={<SheetClose>关闭</SheetClose>}
            >
              <BillingDetail record={record} />
            </Sheet>
          )}
          empty={
            keyword() || status() !== "all" || ledger() !== "all" || model() !== "all"
              ? "没有匹配的记录"
              : "暂无流水"
          }
          emptyDescription={
            keyword() || status() !== "all" || ledger() !== "all" || model() !== "all"
              ? "试试调整搜索词或筛选条件"
              : "还没有产生计费记录"
          }
        />

        <div class="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/60 px-5 py-3">
          <p class="text-sm text-muted-foreground">
            筛选出 {formatNumber(filtered().length)} 条，本次消耗{" "}
            <DecimalSplit text={formatPoints(revenueTotal())} /> 积分
          </p>
          <PagerIfNeeded
            page={page()}
            size={pageSize()}
            total={filtered().length}
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

/** 抽屉：用量与指标 / 计费明细 / 标识与时间三段 */
function BillingDetail(props: { record: BillingRecord }) {
  const record = () => props.record;
  const latency = () => (record().latency_ms ? formatLatency(record().latency_ms!) : "—");

  return (
    <div class="space-y-5">
      <div class="flex flex-wrap items-center gap-2">
        <Badge variant={billingStatusMeta(record().status).variant}>
          {billingStatusMeta(record().status).label}
        </Badge>
        <Badge variant={ledgerMeta(record().ledger).variant}>
          {ledgerMeta(record().ledger).label}
        </Badge>
        <Badge variant="secondary">{record().stream ? "流式" : "非流式"}</Badge>
        <Badge variant="secondary">{record().entry}</Badge>
        <Show when={record().status === "error"}>
          <Badge variant="warning">未计费</Badge>
        </Show>
      </div>

      <Section title="用量与指标">
        <MetricGrid
          items={[
            { label: "Token 合计", value: formatNumber(record().total_tokens) },
            { label: "输入", value: formatNumber(record().prompt_tokens) },
            { label: "输出", value: formatNumber(record().completion_tokens) },
            { label: "缓存读", value: formatNumber(record().cache_read_tokens) },
            { label: "缓存写", value: formatNumber(record().cache_write_tokens) },
            { label: "延迟", value: latency() },
          ]}
        />
      </Section>

      <Section title="计费明细">
        <dl class="space-y-2.5 text-sm">
          <DetailRow label="计费模式" value={record().billing_mode === "subscription" ? "订阅" : "按量"} />
          <DetailRow label="支付方式" value={ledgerMeta(record().ledger).label} />
          <DetailRow
            label="成本"
            value={<DecimalSplit text={formatPoints(record().cost_amount)} />}
          />
          <DetailRow
            label="实付"
            value={<DecimalSplit text={formatPoints(record().revenue_amount)} />}
          />
          <DetailRow label="计费倍率" value={`×${record().revenue_multiplier}`} />
          <Show when={record().owner_credit_amount > 0}>
            <DetailRow
              label="渠道分成"
              value={<DecimalSplit text={formatPoints(record().owner_credit_amount)} />}
            />
          </Show>
        </dl>
      </Section>

      <Section title="标识与时间">
        <dl class="space-y-2.5 text-sm">
          <DetailRow label="请求 ID" value={<CopyableId value={record().request_id} />} />
          <DetailRow label="渠道" value={record().channel_name} />
          <DetailRow label="记录时间" value={formatDateTime(record().created_at)} />
        </dl>
      </Section>

      <p class="text-xs text-muted-foreground">
        单位说明：金额按 1 元 = 10000 积分换算显示，成本是平台付给上游的价，实付是你实际扣掉的积分。
      </p>
    </div>
  );
}
