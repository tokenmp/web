import type { APIEvent } from "@solidjs/start/server";
import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm";

import { requireUser } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, toSnake } from "~/lib/http";
import { notifications } from "~/lib/schema";

/**
 * GET /api/notifications
 *
 * 当前用户的通知，新的在前。过期的（expires_at 已过）不返回。
 * 查询参数：page、size、unread=1 只看未读。
 * 响应里带 unread，前端不用再单独请求一次未读数。
 */
export async function GET({ request }: APIEvent) {
  const user = await requireUser(request);
  if (!user) return errorJson("未登录", 401);

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get("size") ?? 20) || 20));
  const unreadOnly = ["1", "true", "yes"].includes(
    (url.searchParams.get("unread") ?? "").toLowerCase(),
  );

  const now = new Date();
  const notExpired = or(isNull(notifications.expiresAt), sql`${notifications.expiresAt} > ${now}`);
  const base = and(eq(notifications.userId, user.id), notExpired);
  const where = unreadOnly ? and(base, isNull(notifications.readAt)) : base;

  const [items, [total], [unread]] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ n: count() }).from(notifications).where(where),
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(base, isNull(notifications.readAt))),
  ]);

  return json({ items: items.map(toSnake), total: Number(total?.n ?? 0), unread: Number(unread?.n ?? 0) });
}
