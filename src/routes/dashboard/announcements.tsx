import { Title } from "@solidjs/meta";
import Archive from "lucide-solid/icons/archive";
import Pencil from "lucide-solid/icons/pencil";
import Plus from "lucide-solid/icons/plus";
import Rocket from "lucide-solid/icons/rocket";
import Trash from "lucide-solid/icons/trash";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

import { PageHeader, StatRow } from "~/components/layout/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Dialog } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Segmented } from "~/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";
import { createClientResource } from "~/lib/resource";
import {
  announcementStatusLabels,
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  fetchAdminAnnouncements,
  publishAnnouncement,
  severityLabels,
  updateAnnouncement,
  type Announcement,
  type Severity,
} from "~/lib/system";
import { formatDateTime, formatNumber, toDateTimeLocal } from "~/lib/utils";

const STATUS_TABS = [
  { value: "all", label: "全部" },
  { value: "draft", label: "草稿" },
  { value: "published", label: "已发布" },
  { value: "archived", label: "已归档" },
] as const;

type StatusFilter = (typeof STATUS_TABS)[number]["value"];

const SEVERITY_OPTIONS: { value: Severity; label: string }[] = [
  { value: "info", label: severityLabels.info },
  { value: "warning", label: severityLabels.warning },
  { value: "urgent", label: severityLabels.urgent },
];

function severityVariant(severity: string): "secondary" | "warning" | "destructive" {
  if (severity === "urgent") return "destructive";
  if (severity === "warning") return "warning";
  return "secondary";
}

function statusVariant(status: string): "outline" | "success" | "secondary" {
  if (status === "published") return "success";
  if (status === "archived") return "secondary";
  return "outline";
}

/**
 * 公告管理。
 *
 * 列表把草稿和归档的也算上 —— 管理端要能看见全部，用户端的接口只给生效中的。
 * 筛选在本地做：接口一次就把整份列表拿回来了，切标签再请求一次没有意义。
 *
 * 新建出来是草稿，发布是另一个动作（后端的约定），所以表单的提交按钮写的是
 * 「存为草稿」，免得管理员以为点一下就会推给全站。
 */
export default function DashboardAnnouncements() {
  const { data, loading, error, reload } = createClientResource<Announcement[]>(
    fetchAdminAnnouncements,
    [],
  );
  const [filter, setFilter] = createSignal<StatusFilter>("all");
  const [formOpen, setFormOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<Announcement | null>(null);
  const [pendingDelete, setPendingDelete] = createSignal<Announcement | null>(null);
  const [busyId, setBusyId] = createSignal<number | null>(null);
  const [notice, setNotice] = createSignal("");

  const filtered = createMemo(() =>
    filter() === "all" ? data() : data().filter(item => item.status === filter()),
  );

  const stats = () => {
    const list = data();
    return [
      { label: "公告总数", value: formatNumber(list.length) },
      {
        label: "已发布",
        value: formatNumber(list.filter(item => item.status === "published").length),
        hint: "用户端可见",
      },
      { label: "草稿", value: formatNumber(list.filter(item => item.status === "draft").length) },
      {
        label: "已归档",
        value: formatNumber(list.filter(item => item.status === "archived").length),
        hint: "可重新发布",
      },
    ];
  };

  const openForm = (item: Announcement | null) => {
    setNotice("");
    setEditing(item);
    setFormOpen(true);
  };

  const run = async (item: Announcement, action: (id: number) => Promise<unknown>) => {
    setBusyId(item.id);
    setNotice("");
    try {
      await action(item.id);
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    const item = pendingDelete();
    if (!item) return;

    setBusyId(item.id);
    setNotice("");
    try {
      await deleteAnnouncement(item.id);
      setPendingDelete(null);
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Title>公告 | TokenMP 销售控制台</Title>

      <PageHeader>
        <Button onClick={() => openForm(null)}>
          <Plus class="size-4" aria-hidden="true" />
          新建公告
        </Button>
      </PageHeader>

      <StatRow items={stats()} />

      <Card class="overflow-hidden">
        <div class="flex flex-wrap items-center gap-2 border-b p-4">
          <Segmented
            options={STATUS_TABS}
            value={filter()}
            onChange={setFilter}
            ariaLabel="按状态筛选公告"
          />
          <p class="text-sm text-muted-foreground lg:ml-auto">
            共 {formatNumber(filtered().length)} 条
          </p>
        </div>

        <Show when={notice()}>
          <p class="border-b bg-destructive/10 px-4 py-2.5 text-sm text-destructive-text" role="alert">
            {notice()}
          </p>
        </Show>

        <Show when={error()}>
          <div class="border-b px-4 py-6 text-center text-sm">
            <p class="text-muted-foreground">{error()}</p>
            <Button variant="outline" size="sm" class="mt-3" onClick={() => void reload()}>
              重新加载
            </Button>
          </div>
        </Show>

        <Table class="border-b" tableClass="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead>标题</TableHead>
              <TableHead>级别</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>生效时间</TableHead>
              <TableHead>可关闭</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={filtered()}>
              {item => (
                <TableRow>
                  <TableCell>
                    <p class="font-medium">{item.title}</p>
                    <p class="mt-0.5 line-clamp-1 max-w-[26rem] text-xs text-muted-foreground">
                      {item.body}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={severityVariant(item.severity)}>
                      {severityLabels[item.severity] ?? item.severity}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(item.status)}>
                      {announcementStatusLabels[item.status] ?? item.status}
                    </Badge>
                  </TableCell>
                  <TableCell class="whitespace-nowrap tabular-nums text-muted-foreground">
                    <p>{formatDateTime(item.publish_from)}</p>
                    <Show when={item.publish_until} fallback={<p class="text-xs">长期有效</p>}>
                      <p class="text-xs">至 {formatDateTime(item.publish_until)}</p>
                    </Show>
                  </TableCell>
                  <TableCell class="text-muted-foreground">{item.dismissible ? "是" : "否"}</TableCell>
                  <TableCell>
                    <div class="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId() === item.id}
                        aria-label={`编辑公告：${item.title}`}
                        onClick={() => openForm(item)}
                      >
                        <Pencil class="size-3.5" aria-hidden="true" />
                        编辑
                      </Button>

                      <Button
                        variant={item.status === "published" ? "outline" : "default"}
                        size="sm"
                        disabled={busyId() === item.id}
                        aria-label={
                          item.status === "published"
                            ? `归档公告：${item.title}`
                            : `发布公告：${item.title}`
                        }
                        onClick={() =>
                          run(
                            item,
                            item.status === "published"
                              ? archiveAnnouncement
                              : publishAnnouncement,
                          )
                        }
                      >
                        {item.status === "published" ? (
                          <Archive class="size-3.5" aria-hidden="true" />
                        ) : (
                          <Rocket class="size-3.5" aria-hidden="true" />
                        )}
                        {item.status === "published"
                          ? "归档"
                          : item.status === "archived"
                            ? "重新发布"
                            : "发布"}
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        class="text-destructive-text"
                        disabled={busyId() === item.id}
                        aria-label={`删除公告：${item.title}`}
                        onClick={() => setPendingDelete(item)}
                      >
                        <Trash class="size-3.5" aria-hidden="true" />
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </For>

            <Show when={filtered().length === 0}>
              <TableRow>
                <TableCell class="py-10 text-center text-muted-foreground" colSpan={6}>
                  {loading()
                    ? "正在加载…"
                    : filter() === "all"
                      ? "还没有公告，点右上角「新建公告」发一条"
                      : "这个状态下没有公告"}
                </TableCell>
              </TableRow>
            </Show>
          </TableBody>
        </Table>
      </Card>

      <AnnouncementForm
        open={formOpen()}
        item={editing()}
        onOpenChange={setFormOpen}
        onSaved={() => void reload()}
      />

      <Dialog
        open={pendingDelete() !== null}
        onOpenChange={open => {
          if (!open) setPendingDelete(null);
        }}
        title="删除这条公告？"
        description="用户端立刻不再显示，用户的关闭记录也会一并删掉，删了取不回来。"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busyId() === pendingDelete()?.id}
              onClick={() => void remove()}
            >
              删除
            </Button>
          </>
        }
      />
    </>
  );
}

/** 新建与编辑共用一个表单弹窗：触发按钮在页面和列表行上，所以用受控的 open */
function AnnouncementForm(props: {
  open: boolean;
  item: Announcement | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = createSignal("");
  const [body, setBody] = createSignal("");
  const [severity, setSeverity] = createSignal<Severity>("info");
  const [dismissible, setDismissible] = createSignal(true);
  const [publishFrom, setPublishFrom] = createSignal("");
  const [publishUntil, setPublishUntil] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [pending, setPending] = createSignal(false);

  const isEdit = () => props.item !== null;

  // 每次打开都把表单填成当前这条（新建则清空）。弹窗常驻在页面里，
  // 不重置的话会残留上一次的内容。
  createEffect(() => {
    if (!props.open) return;
    const item = props.item;
    setTitle(item?.title ?? "");
    setBody(item?.body ?? "");
    setSeverity((item?.severity as Severity) ?? "info");
    setDismissible(item?.dismissible ?? true);
    setPublishFrom(item?.publish_from ? toDateTimeLocal(item.publish_from) : "");
    setPublishUntil(item?.publish_until ? toDateTimeLocal(item.publish_until) : "");
    setNotice("");
    setPending(false);
  });

  const submit = async () => {
    if (pending()) return;

    if (!title().trim()) {
      setNotice("标题不能为空");
      return;
    }
    if (!body().trim()) {
      setNotice("正文不能为空");
      return;
    }
    if (publishFrom() && publishUntil() && publishUntil() <= publishFrom()) {
      setNotice("失效时间要晚于生效时间");
      return;
    }

    const input = {
      title: title().trim(),
      body: body(),
      severity: severity(),
      dismissible: dismissible(),
      publish_from: publishFrom() ? new Date(publishFrom()).toISOString() : null,
      publish_until: publishUntil() ? new Date(publishUntil()).toISOString() : null,
    };

    setPending(true);
    setNotice("");
    try {
      if (props.item) await updateAnnouncement(props.item.id, input);
      else await createAnnouncement(input);

      props.onSaved();
      props.onOpenChange(false);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "保存失败");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={isEdit() ? "编辑公告" : "新建公告"}
      description={
        isEdit()
          ? "保存不会改变发布状态，已发布的公告改完立刻对用户生效"
          : "存下来是草稿，回到列表点「发布」才推给全站"
      }
      class="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      footer={
        <>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={pending()} onClick={() => void submit()}>
            {pending() ? "保存中…" : isEdit() ? "保存修改" : "存为草稿"}
          </Button>
        </>
      }
    >
      {/* 按钮放在弹窗自己的操作区（footer）里，表单这边只管字段；
          回车提交走 onSubmit，点「存为草稿」走上面那个按钮 */}
      <form
        onSubmit={event => {
          event.preventDefault();
          void submit();
        }}
        class="space-y-4"
      >
        <div class="space-y-1.5">
          <Label for="announcement-title">标题</Label>
          <Input
            id="announcement-title"
            value={title()}
            maxLength={255}
            placeholder="例如：v0.1.0 正式发布"
            onInput={event => setTitle(event.currentTarget.value)}
          />
        </div>

        <div class="space-y-1.5">
          <Label for="announcement-body">正文</Label>
          <Textarea
            id="announcement-body"
            rows={5}
            value={body()}
            placeholder="一句话说清发生了什么、用户需要做什么"
            onInput={event => setBody(event.currentTarget.value)}
          />
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="space-y-1.5">
            <Label for="announcement-severity">级别</Label>
            <Segmented
              options={SEVERITY_OPTIONS}
              value={severity()}
              onChange={setSeverity}
              ariaLabel="公告级别"
            />
          </div>

          <label class="flex cursor-pointer items-center gap-2 pb-1 text-sm">
            <input
              type="checkbox"
              checked={dismissible()}
              onChange={event => setDismissible(event.currentTarget.checked)}
              class="size-4 rounded border-input accent-primary"
            />
            <span>用户可自行关闭</span>
          </label>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="announcement-from">生效时间</Label>
            <Input
              id="announcement-from"
              type="datetime-local"
              value={publishFrom()}
              onInput={event => setPublishFrom(event.currentTarget.value)}
            />
            <p class="text-xs text-muted-foreground">留空表示立刻生效</p>
          </div>

          <div class="space-y-1.5">
            <Label for="announcement-until">失效时间</Label>
            <Input
              id="announcement-until"
              type="datetime-local"
              value={publishUntil()}
              onInput={event => setPublishUntil(event.currentTarget.value)}
            />
            <p class="text-xs text-muted-foreground">留空表示一直有效</p>
          </div>
        </div>

        <Show when={notice()}>
          <p class="text-sm text-destructive-text" role="alert">
            {notice()}
          </p>
        </Show>
      </form>
    </Dialog>
  );
}
