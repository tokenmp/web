import type { APIEvent } from "@solidjs/start/server";
import { and, eq, isNull } from "drizzle-orm";

import { requireUser } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { notifications } from "~/lib/schema";

/**
 * POST /api/notifications/{id}/read
 *
 * 把一条通知标为已读。已经读过的再调一次也返回 ok（幂等），
 * 但不属于当前用户的通知返回 404 —— 不区分「不存在」和「不是你的」。
 */
export async function POST({ request, params }: APIEvent) {
  const user = await requireUser(request);
  if (!user) return errorJson("未登录", 401);

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return errorJson("通知 id 不合法", 400);

  const [row] = await db
    .select({ id: notifications.id, readAt: notifications.readAt })
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)))
    .limit(1);

  if (!row) return errorJson("通知不存在", 404);
  if (row.readAt) return json({ ok: true, read_at: row.readAt });

  const now = new Date();
  await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)));

  return json({ ok: true, read_at: now });
}
