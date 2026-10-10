import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";

import { requireUser } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { announcementDismissals, announcements } from "~/lib/schema";

/**
 * POST /api/announcements/{id}/dismiss
 *
 * 记下「当前用户关掉了这条公告」。可以关的公告返回 ok，
 * 标了不可关闭的返回 400，让前端的关闭按钮与后端判断一致。
 */
export async function POST({ request, params }: APIEvent) {
  const user = await requireUser(request);
  if (!user) return errorJson("未登录", 401);

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return errorJson("公告 id 不合法", 400);

  const [row] = await db
    .select({ id: announcements.id, dismissible: announcements.dismissible })
    .from(announcements)
    .where(eq(announcements.id, id))
    .limit(1);

  if (!row) return errorJson("公告不存在", 404);
  if (!row.dismissible) return errorJson("这条公告不允许关闭", 400);

  await db
    .insert(announcementDismissals)
    .values({ userId: user.id, announcementId: id, dismissedAt: new Date() })
    .onDuplicateKeyUpdate({ set: { dismissedAt: new Date() } });

  return json({ ok: true });
}
