import { Title } from "@solidjs/meta";
import Plus from "lucide-solid/icons/plus";
import Search from "lucide-solid/icons/search";
import { createMemo, createSignal, For, Show } from "solid-js";

import { PageHeader, StatRow } from "~/components/layout/page-header";
import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { Dialog, DialogClose } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { formatCurrency } from "~/lib/utils";

type AccountStatus = "正常" | "欠费" | "已停用";

type Account = {
  name: string;
  email: string;
  available: number;
  frozen: number;
  todayCost: number;
  updatedAt: string;
  status: AccountStatus;
};

function statusVariant(status: AccountStatus) {
  if (status === "正常") return "secondary" as const;
  if (status === "欠费") return "destructive" as const;
  return "warning" as const;
}

// 设计样板用的示例数据，接后端时替换
const accounts: Account[] = [
  {
    name: "林知远",
    email: "lin@example.com",
    available: 1284.6,
    frozen: 0,
    todayCost: 32.18,
    updatedAt: "10-10 14:52",
    status: "正常",
  },
  {
    name: "王沐",
    email: "wang@example.com",
    available: 386.05,
    frozen: 50,
    todayCost: 12.4,
    updatedAt: "10-10 14:31",
    status: "正常",
  },
  {
    name: "陈嘉禾",
    email: "chen@example.com",
    available: 0,
    frozen: 0,
    todayCost: 0,
    updatedAt: "10-10 13:58",
    status: "欠费",
  },
  {
    name: "赵启明",
    email: "zhao@example.com",
    available: 5620.9,
    frozen: 200,
    todayCost: 148.62,
    updatedAt: "10-10 13:12",
    status: "正常",
  },
  {
    name: "孙雨桐",
    email: "sun@example.com",
    available: 92.35,
    frozen: 0,
    todayCost: 6.72,
    updatedAt: "10-10 12:40",
    status: "正常",
  },
  {
    name: "周砚",
    email: "zhou@example.com",
    available: 2043.18,
    frozen: 120,
    todayCost: 87.55,
    updatedAt: "10-10 11:26",
    status: "正常",
  },
  {
    name: "吴嘉和",
    email: "wu@example.com",
    available: 318.77,
    frozen: 0,
    todayCost: 21.09,
    updatedAt: "10-10 10:47",
    status: "已停用",
  },
];

/** 本期累计消耗，还没到出账日 */
const pendingSettlement = 1246.8;
/** 本月已入账的充值笔数 */
const settledCount = 18;

export default function DashboardBalances() {
  const [query, setQuery] = createSignal("");

  const filtered = createMemo(() => {
    const keyword = query().trim().toLowerCase();
    if (!keyword) return accounts;
    return accounts.filter(
      account =>
        account.name.toLowerCase().includes(keyword) ||
        account.email.toLowerCase().includes(keyword),
    );
  });

  const totalAvailable = createMemo(() =>
    accounts.reduce((sum, account) => sum + account.available, 0),
  );
  const totalFrozen = createMemo(() => accounts.reduce((sum, account) => sum + account.frozen, 0));
  const todayCost = createMemo(() =>
    accounts.reduce((sum, account) => sum + account.todayCost, 0),
  );

  const stats = createMemo(() => [
    {
      label: "总余额",
      value: formatCurrency(totalAvailable()),
      hint: `${accounts.length} 个账户可用余额合计`,
    },
    { label: "今日消耗", value: formatCurrency(todayCost()), hint: "较昨日 +12.4%" },
    {
      label: "待结算",
      value: formatCurrency(pendingSettlement),
      hint: `T+1 出账，其中冻结 ${formatCurrency(totalFrozen())}`,
    },
    { label: "本月充值", value: formatCurrency(9860), hint: `已入账 ${settledCount} 笔` },
  ]);

  return (
    <>
      <Title>余额 | TokenMP 销售控制台</Title>

      <PageHeader description="查看每个账户的可用余额、冻结金额与今日消耗" />

      <StatRow items={stats()} />

      <Card class="overflow-hidden">
        <div class="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="relative w-full sm:max-w-xs">
            <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              class="pl-9"
              placeholder="搜索用户名或邮箱"
              aria-label="搜索用户"
              value={query()}
              onInput={event => setQuery(event.currentTarget.value)}
            />
          </div>

          <Dialog
            trigger={
              <>
                <Plus class="size-4" />
                批量充值
              </>
            }
            title="批量充值"
            description="设计样板：这个动作还没有接后端接口。"
            footer={
              <>
                <DialogClose>取消</DialogClose>
                <DialogClose variant="default">确认</DialogClose>
              </>
            }
          >
            <p class="text-muted-foreground">
              正式版本会读取上面筛选出来的账户列表，把同一笔金额按可用余额发放给每个账户，并写一条充值流水。
            </p>
          </Dialog>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead class="text-right">可用余额</TableHead>
              <TableHead class="text-right">冻结金额</TableHead>
              <TableHead class="text-right">今日消耗</TableHead>
              <TableHead>最近变动时间</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={filtered()}>
              {account => (
                <TableRow>
                  <TableCell>
                    <div class="flex flex-col gap-1">
                      <span class="flex items-center gap-2">
                        <span class="font-medium">{account.name}</span>
                        <Badge variant={statusVariant(account.status)}>{account.status}</Badge>
                      </span>
                      <span class="text-xs text-muted-foreground">{account.email}</span>
                    </div>
                  </TableCell>
                  <TableCell class="text-right font-medium tabular-nums">
                    {formatCurrency(account.available)}
                  </TableCell>
                  <TableCell class="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(account.frozen)}
                  </TableCell>
                  <TableCell class="text-right tabular-nums">
                    {formatCurrency(account.todayCost)}
                  </TableCell>
                  <TableCell class="whitespace-nowrap tabular-nums text-muted-foreground">
                    {account.updatedAt}
                  </TableCell>
                  <TableCell class="text-right">
                    <Dialog
                      trigger="充值"
                      title="给该用户充值"
                      description={`为 ${account.name} · ${account.email} 增加可用余额`}
                      footer={
                        <>
                          <DialogClose>取消</DialogClose>
                          <DialogClose variant="default">确认</DialogClose>
                        </>
                      }
                    >
                      <div class="space-y-2">
                        <Label for={`topup-${account.email}`}>充值金额（美元）</Label>
                        <Input
                          id={`topup-${account.email}`}
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                        />
                        <p class="text-muted-foreground">
                          充值后立即计入可用余额，可在充值流水里查到这条记录。当前可用余额为{" "}
                          {formatCurrency(account.available)}。
                        </p>
                      </div>
                    </Dialog>
                  </TableCell>
                </TableRow>
              )}
            </For>
            <Show when={filtered().length === 0}>
              <TableRow>
                <TableCell class="py-10 text-center text-muted-foreground" colSpan={6}>
                  没有匹配的账户，换个关键词试试
                </TableCell>
              </TableRow>
            </Show>
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
