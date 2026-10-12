import { Title } from "@solidjs/meta";
import { createSignal, For, Show } from "solid-js";

import { Delta } from "~/components/panel/delta";
import { ResponsiveTable } from "~/components/panel/responsive-table";
import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { DecimalSplit } from "~/components/ui/decimal-split";
import { PagerIfNeeded } from "~/components/ui/pager";
import { detailText, txSourceMeta } from "~/lib/panel-labels";
import { createClientResource } from "~/lib/resource";
import {
  emptyCredits,
  fetchCredits,
  type PanelTransaction,
} from "~/lib/user-panel";
import { formatDateTime, formatNumber, formatPoints, formatRelativeTime } from "~/lib/utils";

const PAGE_SIZE = 10;

/**
 * 记账去向。
 *
 * 一次扣款可能同时扣余额和信用额度，一次入账也可能先把信用额度还上、剩下的才转进余额，
 * 所以这里拼的是「哪几部分参与了」，不是单一的「余额支付」。
 */
function ledgerParts(tx: PanelTransaction) {
  if (tx.delta === 0) return "—";
  const balance = tx.balance_part ?? Math.abs(tx.delta);
  const credit = tx.credit_part ?? 0;
  const hasBalance = balance > 1e-12;
  const hasCredit = credit > 1e-12;

  if (tx.delta < 0) {
    if (hasBalance && hasCredit) return "余额 + 信用支付";
    return hasCredit ? "信用额度支付" : "余额支付";
  }
  if (hasBalance && hasCredit) return "返还信用 + 转入余额";
  return hasCredit ? "返还信用额度" : "转入余额";
}

/**
 * 余额明细。
 *
 * 积分口径跟线上一致：1 元 = 10000 积分，余额、信用都是元，展示时换算。
 * 页头三格是「我到底还能用多少」—— 可用额度 = 余额 + 剩余信用，光看余额会低估。
 *
 * 流水分页走服务端：切换页码与每页条数重新请求（total 在本端点的 data 里，不是顶层）。
 */
export default function PanelCredits() {
  const [page, setPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal(PAGE_SIZE);

  const { data, loading, error, reload } = createClientResource(
    () => fetchCredits({ page: page(), size: pageSize() }),
    emptyCredits,
  );

  const summary = () => {
    const credits = data();
    return [
      {
        label: "可用额度（积分）",
        value: credits.balance + credits.credit_available,
        hint: "余额 + 剩余信用",
      },
      { label: "余额（积分）", value: credits.balance, hint: `¥${credits.balance}` },
      {
        label: "信用额度（积分）",
        value: credits.credit_available,
        hint: `总额度 ¥${credits.credit_limit}`,
      },
    ];
  };

  return (
    <>
      <Title>余额明细 | TokenMP 用户面板</Title>

      <Show when={error()}>
        <p class="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive-text" role="alert">
          {error()}
        </p>
      </Show>

      <div class="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
        <For each={summary()}>
          {item => (
            <div class="bg-card p-4" title={item.hint}>
              <p class="text-xs text-muted-foreground">{item.label}</p>
              <p class="mt-1 text-xl font-semibold tracking-tight md:text-2xl">
                <DecimalSplit text={formatPoints(item.value)} />
              </p>
              <p class="mt-1 text-xs text-muted-foreground">{item.hint}</p>
            </div>
          )}
        </For>
      </div>

      <Card class="mt-5 overflow-hidden">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b p-4">
          <h2 class="text-sm font-semibold">余额流水</h2>
          <p class="text-sm text-muted-foreground">
            {loading() ? "加载中…" : `共 ${formatNumber(data().total)} 条`}
          </p>
        </div>

        <ResponsiveTable
          items={data().transactions}
          rowKey={tx => tx.id}
          minWidth="min-w-[860px]"
          columns={[
            {
              header: "来源",
              cell: tx => (
                <Badge variant={txSourceMeta(tx.source).variant}>
                  {txSourceMeta(tx.source).label}
                </Badge>
              ),
            },
            { header: "变动（积分）", align: "right", cell: tx => <Delta value={tx.delta} /> },
            {
              header: "去向",
              cell: tx => <span class="text-muted-foreground">{ledgerParts(tx)}</span>,
            },
            {
              header: "变动后余额（积分）",
              align: "right",
              cell: tx => <DecimalSplit text={formatPoints(tx.balance_after)} />,
            },
            {
              header: "时间",
              cell: tx => (
                <span class="text-muted-foreground" title={formatDateTime(tx.created_at)}>
                  {formatRelativeTime(tx.created_at)}
                </span>
              ),
            },
          ]}
          cardTitle={tx => tx.model ?? txSourceMeta(tx.source).label}
          cardSubtitle={tx =>
            `${detailText(tx.detail) ?? ledgerParts(tx)} · ${formatRelativeTime(tx.created_at)}`
          }
          cardRight={tx => <Delta value={tx.delta} />}
          empty={loading() ? "加载中…" : "暂无流水"}
          emptyDescription={
            loading() ? undefined : "调用模型之后，这里会按时间列出每一笔扣款"
          }
        />

        <div class="px-5">
          <PagerIfNeeded
            page={page()}
            size={pageSize()}
            total={data().total}
            onPageChange={next => {
              setPage(next);
              void reload();
            }}
            onSizeChange={value => {
              setPageSize(value);
              setPage(1);
              void reload();
            }}
          />
        </div>
      </Card>
    </>
  );
}
