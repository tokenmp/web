import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";

import { requireAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, toSnake } from "~/lib/http";
import { announcements } from "~/lib/schema";

const SEVERITIES = ["info", "warning", "urgent"] as const;
const STATUSES = ["draft", "published", "archived"] as const;

function parseId(raw: string | undefined) {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function parseDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** GET /api/admin/announcements/{id} */
export async function GET({ request, params }: APIEvent) {
  const admin = await requireAdmin(request);
  if (!admin) return errorJson("需要管理员权限", 403);

  const id = parseId(params.id);
  if (!id) return errorJson("公告 id 不合法", 400);

  const [row] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
  if (!row) return errorJson("公告不存在", 404);

  return json({ data: toSnake(row) });
}

/** PATCH /api/admin/announcements/{id} — 只改传进来的字段 */
export async function PATCH({ request, params }: APIEvent) {
  const admin = await requireAdmin(request);
  if (!admin) return errorJson("需要管理员权限", 403);

  const id = parseId(params.id);
  if (!id) return errorJson("公告 id 不合法", 400);

  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  const [existing] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
  if (!existing) return errorJson("公告不存在", 404);

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (body?.title !== undefined) {
    const title = String(body.title).trim();
    if (!title) return errorJson("标题不能为空", 400);
    if (title.length > 255) return errorJson("标题不能超过 255 字", 400);
    patch.title = title;
  }
  if (body?.body !== undefined) {
    const text = String(body.body);
    if (!text) return errorJson("正文不能为空", 400);
    patch.body = text;
  }
  if (body?.severity !== undefined) {
    const severity = String(body.severity);
    if (!(SEVERITIES as readonly string[]).includes(severity)) {
      return errorJson("severity 只能是 info、warning 或 urgent", 400);
    }
    patch.severity = severity;
  }
  if (body?.status !== undefined) {
    const status = String(body.status);
    if (!(STATUSES as readonly string[]).includes(status)) {
      return errorJson("status 只能是 draft、published 或 archived", 400);
    }
    patch.status = status;
  }
  if (body?.scope !== undefined) patch.scope = String(body.scope).slice(0, 64);
  if (body?.dismissible !== undefined) patch.dismissible = Boolean(body.dismissible);
  if (body?.sort_order !== undefined) patch.sortOrder = Number(body.sort_order) || 0;

  const publishFrom = parseDate(body?.publish_from);
  if (publishFrom !== undefined) {
    if (publishFrom === null) {
      patch.publishFrom = new Date();
    } else {
      patch.publishFrom = publishFrom;
    }
  }
  const publishUntil = parseDate(body?.publish_until);
  if (publishUntil !== undefined) patch.publishUntil = publishUntil;

  const from = patch.publishFrom instanceof Date ? patch.publishFrom : existing.publishFrom;
  const until =
    "publishUntil" in patch ? (patch.publishUntil as Date | null) : existing.publishUntil;
  if (until && until <= from) return errorJson("失效时间必须晚于生效时间", 400);

  await db.update(announcements).set(patch).where(eq(announcements.id, id));

  const [row] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
  return json({ data: row });
}

/** DELETE /api/admin/announcements/{id} */
export async function DELETE({ request, params }: APIEvent) {
  const admin = await requireAdmin(request);
  if (!admin) return errorJson("需要管理员权限", 403);

  const id = parseId(params.id);
  if (!id) return errorJson("公告 id 不合法", 400);

  const [row] = await db.select({ id: announcements.id }).from(announcements).where(eq(announcements.id, id)).limit(1);
  if (!row) return errorJson("公告不存在", 404);

  // announcement_dismissals 上挂了级联删除，用户的关闭记录会一起走
  await db.delete(announcements).where(eq(announcements.id, id));
  return json({ ok: true });
}
