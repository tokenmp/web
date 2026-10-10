import type { APIEvent } from "@solidjs/start/server";
import { and, eq, isNull, sql } from "drizzle-orm";

import { requireUser } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { notifications } from "~/lib/schema";

/**
 * POST /api/notifications/read-all
 *
 * 把当前用户所有未读通知标为已读，返回改了多少条。
 * 注意这条路径是静态段，不会被 /notifications/{id} 抢走。
 */
export async function POST({ request }: APIEvent) {
  const user = await requireUser(request);
  if (!user) return errorJson("未登录", 401);

  const now = new Date();
  const result = await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));

  const updated = Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
  return json({ ok: true, updated });
}
