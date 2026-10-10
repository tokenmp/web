import type { APIEvent } from "@solidjs/start/server";
import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";

import { requireUser } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { json, toSnake } from "~/lib/http";
import { announcementDismissals, announcements } from "~/lib/schema";

/**
 * GET /api/announcements
 *
 * 公开。返回已经发布、且落在生效时间窗里的公告，按 sort_order 升序、新的在前。
 *
 * 登录后额外带 dismissed 字段：这条公告当前用户是不是已经关掉了。
 * 未登录时 dismissed 恒为 false，前端拿 localStorage 自己兜。
 */
export async function GET({ request }: APIEvent) {
  const user = await requireUser(request);
  const now = new Date();

  const rows = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      severity: announcements.severity,
      scope: announcements.scope,
      dismissible: announcements.dismissible,
      sortOrder: announcements.sortOrder,
      publishFrom: announcements.publishFrom,
      publishUntil: announcements.publishUntil,
      updatedAt: announcements.updatedAt,
      dismissed: user
        ? sql<boolean>`exists (
            select 1 from ${announcementDismissals}
            where ${announcementDismissals.announcementId} = ${announcements.id}
              and ${announcementDismissals.userId} = ${user.id}
          )`
        : sql<boolean>`false`,
    })
    .from(announcements)
    .where(
      and(
        eq(announcements.status, "published"),
        lte(announcements.publishFrom, now),
        or(isNull(announcements.publishUntil), sql`${announcements.publishUntil} > ${now}`),
      ),
    )
    .orderBy(asc(announcements.sortOrder), desc(announcements.publishFrom));

  return json({
    items: rows.map(row => toSnake({ ...row, dismissed: Boolean(row.dismissed) })),
    total: rows.length,
  });
}
