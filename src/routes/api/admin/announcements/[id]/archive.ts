import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";

import { requireAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, toSnake } from "~/lib/http";
import { announcements } from "~/lib/schema";

/**
 * POST /api/admin/announcements/{id}/archive
 *
 * 下架。归档后不再出现在用户端的生效列表里，但记录保留，随时能再发布。
 */
export async function POST({ request, params }: APIEvent) {
  const admin = await requireAdmin(request);
  if (!admin) return errorJson("需要管理员权限", 403);

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return errorJson("公告 id 不合法", 400);

  const [row] = await db.select({ id: announcements.id, status: announcements.status }).from(announcements).where(eq(announcements.id, id)).limit(1);
  if (!row) return errorJson("公告不存在", 404);
  if (row.status === "archived") return errorJson("这条公告已经归档了", 409);

  const now = new Date();
  await db
    .update(announcements)
    .set({ status: "archived", updatedAt: now })
    .where(eq(announcements.id, id));

  const [updated] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
  return json({ data: toSnake(updated) });
}
