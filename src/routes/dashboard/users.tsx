import { Title } from "@solidjs/meta";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Search from "lucide-solid/icons/search";
import UserPlus from "lucide-solid/icons/user-plus";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";

import { PageHeader, StatRow } from "~/components/layout/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Segmented } from "~/components/ui/segmented";
import { Sheet, SheetClose } from "~/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { formatCurrency, formatNumber } from "~/lib/utils";

// 设计样板用的示例数据，接后端时替换
type UserStatus = "正常" | "试用中" | "已封禁";

type CallRecord = {
  model: string;
  at: string;
  tokens: number;
  cost: number;
  ok: boolean;
};

type User = {
  email: string;
  plan: string;
  balance: number;
  spent: number;
  joinedAt: string;
  status: UserStatus;
  calls: CallRecord[];
};

const users: User[] = [
  {
    email: "lin.zy@example.com",
    plan: "专业版月付",
    balance: 128.4,
    spent: 2018.65,
    joinedAt: "2026-03-12",
    status: "正常",
    calls: [
      { model: "gpt-4o", at: "10-10 14:52", tokens: 18420, cost: 0.42, ok: true },
      { model: "claude-sonnet-4", at: "10-10 14:31", tokens: 9210, cost: 0.28, ok: true },
      { model: "gpt-4o-mini", at: "10-10 13:58", tokens: 26400, cost: 0.06, ok: true },
      { model: "gemini-2.5-flash", at: "10-10 11:22", tokens: 41800, cost: 0.09, ok: true },
      { model: "deepseek-v3", at: "10-10 09:04", tokens: 12600, cost: 0.03, ok: false },
    ],
  },
  {
    email: "wang.qi@example.com",
    plan: "标准版月付",
    balance: 42.1,
    spent: 866.2,
    joinedAt: "2026-05-08",
    status: "正常",
    calls: [
      { model: "gpt-4o-mini", at: "10-10 15:07", tokens: 31200, cost: 0.07, ok: true },
      { model: "gpt-4o-mini", at: "10-10 14:44", tokens: 15800, cost: 0.04, ok: true },
      { model: "deepseek-v3", at: "10-10 12:19", tokens: 47300, cost: 0.11, ok: true },
      { model: "gpt-4o", at: "10-10 10:36", tokens: 6420, cost: 0.19, ok: true },
      { model: "claude-haiku-4", at: "10-10 08:51", tokens: 9800, cost: 0.05, ok: true },
    ],
  },
  {
    email: "chen.mo@example.com",
    plan: "按量付费",
    balance: 310.75,
    spent: 121.4,
    joinedAt: "2026-06-19",
    status: "试用中",
    calls: [
      { model: "gemini-2.5-pro", at: "10-10 15:12", tokens: 22400, cost: 0.31, ok: true },
      { model: "gemini-2.5-flash", at: "10-10 14:02", tokens: 38600, cost: 0.08, ok: true },
      { model: "gpt-4o-mini", at: "10-10 12:47", tokens: 11200, cost: 0.03, ok: true },
      { model: "deepseek-r1", at: "10-10 10:15", tokens: 27900, cost: 0.16, ok: true },
      { model: "gpt-4o", at: "10-10 09:28", tokens: 5400, cost: 0.17, ok: true },
    ],
  },
  {
    email: "zhao.lin@example.com",
    plan: "专业版年付",
    balance: 862.0,
    spent: 5420.9,
    joinedAt: "2025-11-02",
    status: "正常",
    calls: [
      { model: "claude-sonnet-4", at: "10-10 15:20", tokens: 51200, cost: 1.54, ok: true },
      { model: "gpt-4o", at: "10-10 14:38", tokens: 33900, cost: 0.98, ok: true },
      { model: "claude-opus-4", at: "10-10 13:11", tokens: 18600, cost: 2.31, ok: true },
      { model: "gpt-4o-mini", at: "10-10 11:49", tokens: 72800, cost: 0.15, ok: true },
      { model: "gemini-2.5-pro", at: "10-10 09:33", tokens: 26400, cost: 0.37, ok: true },
    ],
  },
  {
    email: "sun.yu@example.com",
    plan: "标准版月付",
    balance: 0,
    spent: 415.3,
    joinedAt: "2026-07-21",
    status: "已封禁",
    calls: [
      { model: "gpt-4o-mini", at: "10-09 22:41", tokens: 128400, cost: 0.27, ok: false },
      { model: "gpt-4o-mini", at: "10-09 22:40", tokens: 96400, cost: 0.21, ok: false },
      { model: "deepseek-v3", at: "10-09 22:38", tokens: 158200, cost: 0.36, ok: false },
      { model: "gpt-4o", at: "10-09 21:55", tokens: 41800, cost: 1.21, ok: true },
      { model: "gpt-4o", at: "10-09 21:12", tokens: 38600, cost: 1.14, ok: true },
    ],
  },
  {
    email: "zhou.han@example.com",
    plan: "企业版年付",
    balance: 4820.55,
    spent: 18640.3,
    joinedAt: "2025-08-15",
    status: "正常",
    calls: [
      { model: "gpt-4o", at: "10-10 15:24", tokens: 88600, cost: 2.64, ok: true },
      { model: "claude-sonnet-4", at: "10-10 15:01", tokens: 74200, cost: 2.18, ok: true },
      { model: "gemini-2.5-pro", at: "10-10 14:22", tokens: 63400, cost: 0.92, ok: true },
      { model: "deepseek-v3", at: "10-10 13:36", tokens: 216800, cost: 0.48, ok: true },
      { model: "claude-opus-4", at: "10-10 12:08", tokens: 32800, cost: 4.06, ok: true },
    ],
  },
  {
    email: "wu.xin@example.com",
    plan: "按量付费",
    balance: 15.6,
    spent: 92.85,
    joinedAt: "2026-09-30",
    status: "试用中",
    calls: [
      { model: "gpt-4o-mini", at: "10-10 14:58", tokens: 8400, cost: 0.02, ok: true },
      { model: "deepseek-v3", at: "10-10 13:20", tokens: 16200, cost: 0.04, ok: true },
      { model: "gemini-2.5-flash", at: "10-10 11:07", tokens: 24800, cost: 0.05, ok: true },
      { model: "gpt-4o", at: "10-10 10:44", tokens: 3600, cost: 0.11, ok: false },
      { model: "gpt-4o-mini", at: "10-10 09:16", tokens: 11200, cost: 0.03, ok: true },
    ],
  },
  {
    email: "zheng.pei@example.com",
    plan: "标准版月付",
    balance: 76.2,
    spent: 1230.45,
    joinedAt: "2026-02-27",
    status: "已封禁",
    calls: [
      { model: "claude-sonnet-4", at: "10-08 19:44", tokens: 42600, cost: 1.28, ok: false },
      { model: "gpt-4o", at: "10-08 18:22", tokens: 31800, cost: 0.92, ok: true },
      { model: "gpt-4o-mini", at: "10-08 17:05", tokens: 52400, cost: 0.11, ok: true },
      { model: "gemini-2.5-pro", at: "10-08 15:37", tokens: 18400, cost: 0.26, ok: true },
      { model: "deepseek-r1", at: "10-08 14:02", tokens: 22600, cost: 0.13, ok: false },
    ],
  },
];

const stats = [
  { label: "总用户数", value: formatNumber(1284), hint: "含试用与已封禁账号" },
  { label: "今日新增", value: formatNumber(37), hint: "较昨日 +8" },
  { label: "活跃用户", value: formatNumber(862), hint: "近 24 小时有调用" },
  { label: "封禁用户", value: formatNumber(19), hint: "近 30 天新增 3 个" },
];

const statusTabs = ["全部", "正常", "已封禁"] as const;

function badgeVariant(status: UserStatus) {
  if (status === "正常") return "success" as const;
  if (status === "已封禁") return "destructive" as const;
  return "warning" as const;
}

export default function DashboardUsers() {
  const [keyword, setKeyword] = createSignal("");
  const [status, setStatus] = createSignal<(typeof statusTabs)[number]>("全部");

  const filtered = createMemo(() => {
    const query = keyword().trim().toLowerCase();
    return users.filter(user => {
      const matchStatus = status() === "全部" || user.status === status();
      const matchQuery = query === "" || user.email.toLowerCase().includes(query);
      return matchStatus && matchQuery;
    });
  });

  return (
    <>
      <Title>用户 | TokenMP 销售控制台</Title>

      <PageHeader description="管理账户、套餐与余额，查看最近的调用记录" />

      <StatRow items={stats} />

      <Card class="overflow-hidden">
        <div class="flex flex-wrap items-center gap-2 border-b p-4">
          <div class="relative w-full sm:w-64">
            <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              class="pl-8"
              placeholder="按邮箱搜索"
              aria-label="按邮箱搜索用户"
              value={keyword()}
              onInput={event => setKeyword(event.currentTarget.value)}
            />
          </div>

          <Segmented
            options={statusTabs}
            value={status()}
            onChange={setStatus}
            ariaLabel="用户状态"
          />

          <Button class="ml-auto">
            <UserPlus class="size-4" />
            新增用户
          </Button>
        </div>

        <Table class="border-b" tableClass="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead>邮箱</TableHead>
              <TableHead>套餐</TableHead>
              <TableHead class="text-right">余额</TableHead>
              <TableHead class="text-right">累计消耗</TableHead>
              <TableHead>注册时间</TableHead>
              <TableHead>状态</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={filtered()}>
              {user => (
                <TableRow>
                  <TableCell class="font-medium">{user.email}</TableCell>
                  <TableCell class="text-muted-foreground">{user.plan}</TableCell>
                  <TableCell class="text-right tabular-nums">{formatCurrency(user.balance)}</TableCell>
                  <TableCell class="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(user.spent)}
                  </TableCell>
                  <TableCell class="tabular-nums text-muted-foreground">{user.joinedAt}</TableCell>
                  <TableCell>
                    <Badge variant={badgeVariant(user.status)}>{user.status}</Badge>
                  </TableCell>
                  <TableCell class="text-right">
                    <UserDetailSheet user={user} />
                  </TableCell>
                </TableRow>
              )}
            </For>
            <Show when={filtered().length === 0}>
              <TableRow>
                <TableCell class="py-10 text-center text-muted-foreground" colSpan={7}>
                  没有匹配的用户，换个邮箱关键词或状态试试
                </TableCell>
              </TableRow>
            </Show>
          </TableBody>
        </Table>

        <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm text-muted-foreground">
          <p>
            共 {formatNumber(1284)} 条，当前显示第 {formatNumber(1)} 到{" "}
            {formatNumber(filtered().length)} 条
          </p>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="icon" disabled aria-label="上一页">
              <ChevronLeft class="size-4" />
            </Button>
            <Button variant="outline" size="icon" disabled aria-label="下一页">
              <ChevronRight class="size-4" />
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}

/** 行内「详情」入口，右侧抽屉展示账户信息与最近 5 次调用 */
function UserDetailSheet(props: { user: User }) {
  return (
    <Sheet
      side="right"
      trigger="详情"
      title={props.user.email}
      description={`${props.user.plan} · 注册于 ${props.user.joinedAt}`}
      footer={<SheetClose>关闭</SheetClose>}
    >
      <dl class="space-y-4">
        <Field label="邮箱" value={props.user.email} />
        <Field label="套餐" value={props.user.plan} />
        <Field label="余额" value={formatCurrency(props.user.balance)} />
        <Field label="累计消耗" value={formatCurrency(props.user.spent)} />
        <Field
          label="状态"
          value={<Badge variant={badgeVariant(props.user.status)}>{props.user.status}</Badge>}
        />
      </dl>

      <div class="mt-6">
        <h3 class="text-sm font-medium">最近 5 次调用</h3>
        <div class="mt-3 divide-y rounded-lg border">
          <For each={props.user.calls}>
            {call => (
              <div class="flex items-start justify-between gap-3 p-3">
                <div class="min-w-0">
                  <p class="truncate font-mono text-xs">{call.model}</p>
                  <p class="mt-1 text-xs text-muted-foreground">{call.at}</p>
                </div>
                <div class="shrink-0 text-right">
                  <p class="tabular-nums text-xs">{formatNumber(call.tokens)} tokens</p>
                  <p class="mt-1 flex items-center justify-end gap-1.5">
                    <span class="tabular-nums text-xs text-muted-foreground">
                      {formatCurrency(call.cost, 4)}
                    </span>
                    <Badge variant={call.ok ? "success" : "destructive"}>
                      {call.ok ? "成功" : "失败"}
                    </Badge>
                  </p>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </Sheet>
  );
}

function Field(props: { label: string; value: JSX.Element }) {
  return (
    <div class="flex items-center justify-between gap-4">
      <dt class="text-muted-foreground">{props.label}</dt>
      <dd class="truncate font-medium">{props.value}</dd>
    </div>
  );
}
