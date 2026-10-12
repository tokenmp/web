import { Title } from "@solidjs/meta";
import { createMemo, createSignal, For, Show } from "solid-js";

import { PageHeader, StatRow } from "~/components/layout/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { PagerIfNeeded } from "~/components/ui/pager";
import { Segmented } from "~/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  fetchRechargeOrders,
  RECHARGE_STATUS_LABEL,
  type AdminRechargeOrder,
  type RechargeStatus,
} from "~/lib/admin-recharge";
import { createClientResource } from "~/lib/resource";
import { formatCurrency, formatDateTime, formatNumber } from "~/lib/utils";

/** 分段控件里的「全部」是页面自己的哨兵值，不下发给接口 */
type StatusFilter = "all" | RechargeStatus;

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待支付" },
  { value: "failed", label: "失败" },
  { value: "paid", label: "已到账" },
  { value: "cancelled", label: "已取消" },
  { value: "refunded", label: "已退款" },
];

type BadgeVariant = "secondary" | "success" | "warning" | "destructive";

/** 状态徽标的颜色：待支付要盯（warning），失败要看（destructive），到账为成功 */
function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case "paid":
      return "success";
    case "pending":
      return "warning";
    case "failed":
      return "destructive";
    default:
      return "secondary";
  }
}

function statusLabel(status: string) {
  return RECHARGE_STATUS_LABEL[status as RechargeStatus] ?? status;
}

/** datetime-local 的值转 ISO；空值或非法值返回 undefined，交给后端忽略 */
function toIso(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * 管理端充值单。
 *
 * 这一页看的是充值单本身：谁下的单、走的哪个渠道、渠道回了没、钱有没有进账本。
 * 「计费」页看的是调用扣费（内核回写的计费流水），两者对不上是正常的 —— 一笔还在
 * pending 或已经 failed 的充值单在账本里根本不存在，只有这里能看到，所以运营查
 * 「谁充了多少、哪一单没到账、哪一单回调失败」要看这一页。
 *
 * 筛选与分页都走服务端，状态用分段控件；pending 与 failed 排在前面，是运营最常看的。
 */
function AdminRecharge() {
  const [page, setPage] = createSignal(1);
  const [size, setSize] = createSignal(20);

  // 输入控件绑定的即时值
  const [status, setStatus] = createSignal<StatusFilter>("all");
  const [userId, setUserId] = createSignal("");
  const [channel, setChannel] = createSignal("");
  const [start, setStart] = createSignal("");
  const [end, setEnd] = createSignal("");

  const orders = createClientResource<{ items: AdminRechargeOrder[]; total: number }>(
    () =>
      fetchRechargeOrders({
        page: page(),
        size: size(),
        user_id: userId().trim() || undefined,
        status: status() === "all" ? undefined : status(),
        channel: channel().trim() || undefined,
        start: toIso(start()),
        end: toIso(end()),
      }),
    { items: [], total: 0 },
  );

  const search = () => {
    setPage(1);
    void orders.reload();
  };

  const reset = () => {
    setStatus("all");
    setUserId("");
    setChannel("");
    setStart("");
    setEnd("");
    setPage(1);
    void orders.reload();
  };

  // 概览只统计当前页：分页接口只回一页的 items 与总数，没有全量聚合，
  // 所以每一项都按「本页」标注，不假装是全站数字。
  const stats = createMemo(() => {
    const items = orders.data().items;
    return [
      {
        label: "匹配充值单",
        value: formatNumber(orders.data().total),
        hint: "按当前筛选条件",
      },
      {
        label: "本页待支付",
        value: formatNumber(items.filter(order => order.status === "pending").length),
        hint: "渠道还没回执",
      },
      {
        label: "本页失败",
        value: formatNumber(items.filter(order => order.status === "failed").length),
        hint: "回调失败或渠道拒付",
      },
      {
        label: "本页未入账",
        value: formatNumber(items.filter(order => order.credit_transaction_id === null).length),
        hint: "还没写进账本流水",
      },
    ];
  });

  return (
    <>
      <Title>充值 | TokenMP 销售控制台</Title>

      <PageHeader>
        <Button variant="outline" onClick={() => void orders.reload()}>
          刷新
        </Button>
      </PageHeader>

      <StatRow items={stats()} />

      <Card class="overflow-hidden">
        {/* 这一条是多字段筛选表单，不是一行工具条，所以标签画在控件上方（跟弹窗里一致），
            但标签块的高度要和 Select 自带的 top 标签对齐：space-y-1.5 套 leading-none 的 Label */}
        <div class="space-y-3 border-b px-4 py-3">
          <Segmented
            options={STATUS_OPTIONS}
            value={status()}
            onChange={value => {
              setStatus(value);
              setPage(1);
              void orders.reload();
            }}
            ariaLabel="按充值单状态筛选"
          />

          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div class="space-y-1.5">
              <Label for="recharge-user">用户 ID</Label>
              <Input
                id="recharge-user"
                inputmode="numeric"
                placeholder="精确匹配"
                value={userId()}
                onInput={event => setUserId(event.currentTarget.value)}
              />
            </div>
            <div class="space-y-1.5">
              <Label for="recharge-channel">渠道</Label>
              <Input
                id="recharge-channel"
                placeholder="如 mock"
                value={channel()}
                onInput={event => setChannel(event.currentTarget.value)}
              />
            </div>
            <div class="space-y-1.5">
              <Label for="recharge-start">开始时间</Label>
              <Input
                id="recharge-start"
                type="datetime-local"
                value={start()}
                onInput={event => setStart(event.currentTarget.value)}
              />
            </div>
            <div class="space-y-1.5">
              <Label for="recharge-end">结束时间</Label>
              <Input
                id="recharge-end"
                type="datetime-local"
                value={end()}
                onInput={event => setEnd(event.currentTarget.value)}
              />
            </div>
            <div class="flex items-end gap-2 lg:col-span-4">
              <Button onClick={search}>查询</Button>
              <Button variant="outline" onClick={reset}>
                重置
              </Button>
            </div>
          </div>
        </div>

        <Show when={orders.error()}>
          <div class="border-b px-4 py-6 text-center text-sm">
            <p class="text-muted-foreground">{orders.error()}</p>
            <Button variant="outline" size="sm" class="mt-3" onClick={() => void orders.reload()}>
              重新加载
            </Button>
          </div>
        </Show>

        <Table class="border-b" tableClass="min-w-[1040px]">
          <TableHeader>
            <TableRow>
              <TableHead>单号</TableHead>
              <TableHead>用户</TableHead>
              <TableHead class="text-right">金额</TableHead>
              <TableHead>渠道</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>到账时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={orders.data().items}>
              {order => (
                <TableRow>
                  <TableCell class="font-mono text-xs text-muted-foreground">
                    {order.order_no}
                  </TableCell>
                  <TableCell>
                    <p class="font-medium">{order.user_name}</p>
                    <p class="text-xs text-muted-foreground">
                      #{order.user_id}
                      <Show when={order.user_email}> · {order.user_email}</Show>
                    </p>
                  </TableCell>
                  <TableCell class="text-right font-medium tabular-nums">
                    {formatCurrency(order.amount)}
                  </TableCell>
                  <TableCell class="text-muted-foreground">{order.channel}</TableCell>
                  <TableCell>
                    <div class="flex flex-wrap items-center gap-1.5">
                      <Badge variant={statusVariant(order.status)}>{statusLabel(order.status)}</Badge>
                      <Show when={order.credit_transaction_id === null}>
                        <Badge variant="outline">未入账</Badge>
                      </Show>
                    </div>
                  </TableCell>
                  <TableCell class="tabular-nums text-muted-foreground">
                    {formatDateTime(order.created_at)}
                  </TableCell>
                  <TableCell class="tabular-nums text-muted-foreground">
                    {order.paid_at ? formatDateTime(order.paid_at) : "—"}
                  </TableCell>
                </TableRow>
              )}
            </For>

            <Show when={orders.data().items.length === 0}>
              <TableRow>
                <TableCell class="py-10 text-center text-muted-foreground" colSpan={7}>
                  {orders.loading() ? "正在加载…" : "没有符合条件的充值单"}
                </TableCell>
              </TableRow>
            </Show>
          </TableBody>
        </Table>

        <PagerIfNeeded
          page={page()}
          size={size()}
          total={orders.data().total}
          onPageChange={next => {
            setPage(next);
            void orders.reload();
          }}
          onSizeChange={next => {
            setSize(next);
            setPage(1);
            void orders.reload();
          }}
        />
      </Card>
    </>
  );
}

export default AdminRecharge;
