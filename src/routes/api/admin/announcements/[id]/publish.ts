import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";

import { requireAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, toSnake } from "~/lib/http";
import { announcements } from "~/lib/schema";

/**
 * POST /api/admin/announcements/{id}/publish
 *
 * 把草稿发出去。已经发布过的再调一次返回 409，
 * 免得重复点把 publish_from 又刷成当前时间。
 */
export async function POST({ request, params }: APIEvent) {
  const admin = await requireAdmin(request);
  if (!admin) return errorJson("需要管理员权限", 403);

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return errorJson("公告 id 不合法", 400);

  const [row] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
  if (!row) return errorJson("公告不存在", 404);
  if (row.status === "published") return errorJson("这条公告已经发布过了", 409);

  const now = new Date();
  // 归档过的重新发布，把生效时间往前挪到当下，否则会被旧时间窗挡住
  const publishFrom = row.publishFrom > now ? row.publishFrom : now;

  await db
    .update(announcements)
    .set({ status: "published", publishFrom, updatedAt: now })
    .where(eq(announcements.id, id));

  const [updated] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
  return json({ data: toSnake(updated) });
}
