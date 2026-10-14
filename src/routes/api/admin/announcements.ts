import type { APIEvent } from "@solidjs/start/server";
import { and, asc, count, desc, eq } from "drizzle-orm";

import { requireAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, toSnake } from "~/lib/http";
import { announcements } from "~/lib/schema";

const SEVERITIES = ["info", "warning", "urgent"] as const;
const STATUSES = ["draft", "published", "archived"] as const;

function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * GET /api/admin/announcements
 *
 * 公告列表，草稿和归档的也在里面 —— 管理端要能看见全部。
 * 查询参数：page、size、status。
 *
 * 还多回一个 `status_counts`：各状态的全站条数，给页头那四张卡用。
 * 卡片必须与列表同口径（都是全站数字），而分页接口只回一页的 items，
 * 前端数 items 会得出「已发布 0 条」这种假数。原先是前端按状态各发一次
 * `size=1` 的请求去凑，四次请求只是换一个 GROUP BY —— 这里一次查询里带上，
 * 前端那次拼装整个不要了。
 *
 * `status_counts` 不受 status 筛选影响，永远是全站的：切到「草稿」那一页时，
 * 卡片仍要显示已发布有多少条，否则卡片会跟着筛选一起变，读起来像「全站只剩草稿」。
 */
export async function GET({ request }: APIEvent) {
  const admin = await requireAdmin(request);
  if (!admin) return errorJson("需要管理员权限", 403);

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get("size") ?? 20) || 20));
  const status = url.searchParams.get("status");

  const where =
    status && (STATUSES as readonly string[]).includes(status)
      ? eq(announcements.status, status)
      : undefined;

  const [items, [total], byStatus] = await Promise.all([
    db
      .select()
      .from(announcements)
      .where(where)
      .orderBy(asc(announcements.sortOrder), desc(announcements.createdAt))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ n: count() }).from(announcements).where(where),
    db
      .select({ status: announcements.status, n: count() })
      .from(announcements)
      .groupBy(announcements.status),
  ]);

  // 三个状态固定给全，某个状态一条都没有时也要是 0 而不是缺键，
  // 前端拿它直接画卡，不用再 ?? 一遍。total 由三档相加，与 status 筛选无关 ——
  // 它就是「公告总数」那张卡，不能跟着筛选走。
  const statusCounts: Record<string, number> = {};
  for (const key of STATUSES) statusCounts[key] = 0;
  for (const row of byStatus) statusCounts[row.status] = Number(row.n);

  return json({
    items: items.map(toSnake),
    total: Number(total?.n ?? 0),
    status_counts: {
      total: STATUSES.reduce((sum, key) => sum + statusCounts[key], 0),
      ...statusCounts,
    },
  });
}

/**
 * POST /api/admin/announcements
 *
 * 新建公告。默认建成草稿 —— 发布是单独的动作，
 * 免得手一抖点保存就把公告推给全站。
 */
export async function POST({ request }: APIEvent) {
  const admin = await requireAdmin(request);
  if (!admin) return errorJson("需要管理员权限", 403);

  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  const title = String(body?.title ?? "").trim();
  const text = String(body?.body ?? "");
  if (!title) return errorJson("标题不能为空", 400);
  if (title.length > 255) return errorJson("标题不能超过 255 字", 400);
  if (!text) return errorJson("正文不能为空", 400);

  const severity = String(body?.severity ?? "info");
  if (!(SEVERITIES as readonly string[]).includes(severity)) {
    return errorJson("severity 只能是 info、warning 或 urgent", 400);
  }

  const publishFrom = parseDate(body?.publish_from) ?? new Date();
  const publishUntil = parseDate(body?.publish_until);
  if (publishUntil && publishUntil <= publishFrom) {
    return errorJson("失效时间必须晚于生效时间", 400);
  }

  const now = new Date();
  const [created] = await db
    .insert(announcements)
    .values({
      title,
      body: text,
      severity,
      scope: String(body?.scope ?? "all").slice(0, 64),
      dismissible: body?.dismissible === undefined ? true : Boolean(body.dismissible),
      status: "draft",
      sortOrder: Number(body?.sort_order ?? 0) || 0,
      publishFrom,
      publishUntil,
      createdBy: admin.id,
      createdAt: now,
      updatedAt: now,
    })
    .$returningId();

  const [row] = await db
    .select()
    .from(announcements)
    .where(eq(announcements.id, created.id))
    .limit(1);

  return json({ data: toSnake(row) }, 201);
}
