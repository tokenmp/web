import type { APIEvent } from "@solidjs/start/server";
import { count, desc, eq, inArray, sql } from "drizzle-orm";

import { requireAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, toSnake } from "~/lib/http";
import { notifications, users } from "~/lib/schema";

const SEVERITIES = ["info", "warning", "urgent"] as const;

/**
 * GET /api/admin/notifications
 *
 * 通知的投递记录。查询参数：page、size、user_id、type。
 */
export async function GET({ request }: APIEvent) {
  const admin = await requireAdmin(request);
  if (!admin) return errorJson("需要管理员权限", 403);

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get("size") ?? 20) || 20));
  const userId = Number(url.searchParams.get("user_id") ?? 0);
  const type = url.searchParams.get("type");

  const filters = [];
  if (Number.isFinite(userId) && userId > 0) filters.push(eq(notifications.userId, userId));
  if (type) filters.push(eq(notifications.type, type));
  const where = filters.length ? sql.join(filters, sql` and `) : undefined;

  const [items, [total]] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ n: count() }).from(notifications).where(where),
  ]);

  return json({ items: items.map(toSnake), total: Number(total?.n ?? 0) });
}

/**
 * POST /api/admin/notifications
 *
 * 给一个或多个用户发通知。
 *   user_id  单个，user_ids 批量，两者至少要有一个
 *   idempotency_key  可选。填了就按它去重：同一个键重复投递只落一条
 *                    （比如「余额不足」这种每天会触发的事件，用它避免刷屏）
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

  const single = Number(body?.user_id ?? 0);
  const many = Array.isArray(body?.user_ids) ? body.user_ids.map(Number) : [];
  const targets = [...new Set([...(single > 0 ? [single] : []), ...many])].filter(
    id => Number.isFinite(id) && id > 0,
  );
  if (!targets.length) return errorJson("请指定 user_id 或 user_ids", 400);

  const title = String(body?.title ?? "").trim();
  if (!title) return errorJson("标题不能为空", 400);
  if (title.length > 255) return errorJson("标题不能超过 255 字", 400);

  const severity = String(body?.severity ?? "info");
  if (!(SEVERITIES as readonly string[]).includes(severity)) {
    return errorJson("severity 只能是 info、warning 或 urgent", 400);
  }

  const existing = await db.select({ id: users.id }).from(users).where(inArray(users.id, targets));
  if (existing.length !== targets.length) {
    const found = new Set(existing.map(row => row.id));
    const missing = targets.filter(id => !found.has(id));
    return errorJson(`用户不存在：${missing.join("、")}`, 404);
  }

  const now = new Date();
  const expiresAtRaw = body?.expires_at;
  const expiresAt = expiresAtRaw ? new Date(String(expiresAtRaw)) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return errorJson("expires_at 不是合法时间", 400);

  const baseKey = body?.idempotency_key ? String(body.idempotency_key).slice(0, 120) : null;
  const actionLabel = body?.action_label ? String(body.action_label).slice(0, 128) : null;
  const actionUrl = body?.action_url ? String(body.action_url).slice(0, 512) : null;
  const type = String(body?.type ?? "").slice(0, 64);
  const text = body?.body === undefined || body.body === null ? null : String(body.body);
  const metadata = body?.metadata ?? null;

  const values = targets.map(userId => ({
    userId,
    type,
    title,
    body: text,
    severity,
    actionLabel,
    actionUrl,
    metadata,
    expiresAt,
    // 批量发的时候给每个用户拼上自己的 id，否则所有人共用一个键，只有第一个人收得到
    idempotencyKey: baseKey ? `${baseKey}:${userId}` : null,
    createdAt: now,
  }));

  await db.insert(notifications).values(values).onDuplicateKeyUpdate({
    set: { title: sql`values(title)`, body: sql`values(body)` },
  });

  return json({ ok: true, created: values.length }, 201);
}
