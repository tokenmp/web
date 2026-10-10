import { Title } from "@solidjs/meta";
import Check from "lucide-solid/icons/check";
import Copy from "lucide-solid/icons/copy";
import Search from "lucide-solid/icons/search";
import { createMemo, createSignal, For, Show } from "solid-js";

import { PageHeader, StatRow } from "~/components/layout/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
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
import { formatNumber } from "~/lib/utils";

// 设计样板用的示例数据，接后端时替换
type KeyStatus = "启用" | "已停用" | "已过期";

type ApiKey = {
  id: string;
  name: string;
  /** 列表里展示的脱敏形式 */
  masked: string;
  /** 复制按钮写进剪贴板的完整密钥 */
  secret: string;
  createdAt: string;
  lastUsedAt: string;
  status: KeyStatus;
};

const demoKeys: ApiKey[] = [
  {
    id: "key_a91f",
    name: "生产环境-主密钥",
    masked: "sk-live-····a91f",
    secret: "sk-live-9f2c41d7b3e5a8c04d71a91f",
    createdAt: "2025-11-08",
    lastUsedAt: "3 分钟前",
    status: "启用",
  },
  {
    id: "key_4c72",
    name: "生产环境-备用密钥",
    masked: "sk-live-····4c72",
    secret: "sk-live-18b0e6a45c9d27f3b6044c72",
    createdAt: "2026-01-19",
    lastUsedAt: "2 小时前",
    status: "启用",
  },
  {
    id: "key_be03",
    name: "移动端 App",
    masked: "sk-live-····be03",
    secret: "sk-live-7a1f30c8e5d94b6201abbe03",
    createdAt: "2026-02-27",
    lastUsedAt: "昨天 22:41",
    status: "启用",
  },
  {
    id: "key_2f56",
    name: "数据批处理任务",
    masked: "sk-live-····2f56",
    secret: "sk-live-4d9c02b7a6e85f13c80e2f56",
    createdAt: "2025-09-30",
    lastUsedAt: "5 分钟前",
    status: "启用",
  },
  {
    id: "key_c340",
    name: "合作方-启明科技",
    masked: "sk-live-····c340",
    secret: "sk-live-6e27b1d93a05c8f4b72cc340",
    createdAt: "2026-04-12",
    lastUsedAt: "1 小时前",
    status: "启用",
  },
  {
    id: "key_7d18",
    name: "内部压测",
    masked: "sk-test-····7d18",
    secret: "sk-test-3c85a0f26b4e91d78a2c7d18",
    createdAt: "2026-03-15",
    lastUsedAt: "12 天前",
    status: "已停用",
  },
  {
    id: "key_8ab1",
    name: "旧版桌面客户端",
    masked: "sk-live-····8ab1",
    secret: "sk-live-0b47d2c68f31a95e7d4f8ab1",
    createdAt: "2024-06-21",
    lastUsedAt: "2026-06-21",
    status: "已过期",
  },
];

const permissions = [
  "调用全部已上线模型，按平台价目表计费",
  "查询本账户的用量明细与账单",
  "不能修改余额、套餐与团队成员",
];

function badgeVariant(status: KeyStatus) {
  if (status === "启用") return "success" as const;
  if (status === "已过期") return "warning" as const;
  return "secondary" as const;
}

export default function DashboardApiKeys() {
  const [keys, setKeys] = createSignal<ApiKey[]>(demoKeys);
  const [keyword, setKeyword] = createSignal("");
  const [newKeyName, setNewKeyName] = createSignal("");
  const [copied, setCopied] = createSignal<string | null>(null);

  const filtered = createMemo(() => {
    const query = keyword().trim().toLowerCase();
    if (query === "") return keys();
    return keys().filter(
      key => key.name.toLowerCase().includes(query) || key.masked.toLowerCase().includes(query),
    );
  });

  const stats = createMemo(() => [
    { label: "密钥总数", value: formatNumber(keys().length), hint: "含已停用与已过期" },
    { label: "今日调用", value: formatNumber(412860), hint: "较昨日 +6.4%" },
    {
      label: "活跃密钥",
      value: formatNumber(keys().filter(key => key.status === "启用").length),
      hint: "近 7 天有调用",
    },
    {
      label: "已过期",
      value: formatNumber(keys().filter(key => key.status === "已过期").length),
      hint: "建议尽快轮换",
    },
  ]);

  function handleCopy(key: ApiKey) {
    void navigator.clipboard?.writeText(key.secret).catch(() => undefined);
    setCopied(key.id);
    window.setTimeout(() => setCopied(current => (current === key.id ? null : current)), 1500);
  }

  function handleRevoke(key: ApiKey) {
    const revoked: KeyStatus = "已停用";
    setKeys(list => list.map(item => (item.id === key.id ? { ...item, status: revoked } : item)));
  }

  return (
    <>
      <Title>API 密钥 | TokenMP 销售控制台</Title>

      <PageHeader description="为应用和合作方签发调用凭证，随时停用或轮换" />

      <StatRow items={stats()} />

      <Card class="overflow-hidden">
        <div class="flex flex-wrap items-center gap-2 border-b p-4">
          <div class="relative w-full sm:w-64">
            <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              class="pl-8"
              aria-label="按名称或密钥搜索"
              placeholder="按名称或密钥搜索"
              value={keyword()}
              onInput={event => setKeyword(event.currentTarget.value)}
            />
          </div>

          <div class="ml-auto">
            <Dialog
              trigger="新建密钥"
              title="新建 API 密钥"
              description="完整密钥只在创建时显示一次，生成后请立刻保存到安全的位置。"
              footer={
                <>
                  <DialogClose>取消</DialogClose>
                  <DialogClose variant="default">生成</DialogClose>
                </>
              }
            >
              <div class="space-y-4">
                <div class="space-y-2">
                  <Label for="new-key-name">密钥名称</Label>
                  <Input
                    id="new-key-name"
                    placeholder="例如：生产环境-主密钥"
                    value={newKeyName()}
                    onInput={event => setNewKeyName(event.currentTarget.value)}
                  />
                </div>

                <div class="space-y-2">
                  <p class="text-sm font-medium">权限说明</p>
                  <ul class="space-y-2 rounded-lg bg-muted/60 p-3">
                    <For each={permissions}>
                      {item => (
                        <li class="flex items-start gap-2 text-xs text-muted-foreground">
                          <Check class="mt-0.5 size-3.5 shrink-0 text-success-text" />
                          <span>{item}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </div>
            </Dialog>
          </div>
        </div>

        <Table tableClass="min-w-[820px]">
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>密钥</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>最近使用</TableHead>
              <TableHead>状态</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={filtered()}>
              {key => (
                <TableRow>
                  <TableCell class="font-medium">{key.name}</TableCell>
                  <TableCell class="font-mono text-xs text-muted-foreground">{key.masked}</TableCell>
                  <TableCell class="tabular-nums text-muted-foreground">{key.createdAt}</TableCell>
                  <TableCell class="tabular-nums text-muted-foreground">{key.lastUsedAt}</TableCell>
                  <TableCell>
                    <Badge variant={badgeVariant(key.status)}>{key.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div class="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={copied() === key.id ? "已复制密钥" : "复制完整密钥"}
                        onClick={() => handleCopy(key)}
                      >
                        <Show when={copied() === key.id} fallback={<Copy class="size-4" />}>
                          <Check class="size-4 text-success-text" />
                        </Show>
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        disabled={key.status !== "启用"}
                        onClick={() => handleRevoke(key)}
                      >
                        停用
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </For>

            <Show when={filtered().length === 0}>
              <TableRow>
                <TableCell class="py-10 text-center text-muted-foreground" colSpan={6}>
                  没有匹配的密钥，换个名称关键词试试
                </TableCell>
              </TableRow>
            </Show>
          </TableBody>
        </Table>

        <div class="border-t px-5 py-3 text-sm text-muted-foreground">
          共 {formatNumber(keys().length)} 个密钥，其中 {formatNumber(2)} 个超过 180 天未轮换
        </div>
      </Card>
    </>
  );
}
