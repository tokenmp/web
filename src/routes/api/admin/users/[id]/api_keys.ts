import type { APIEvent } from "@solidjs/start/server";
import { desc, eq } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { generateApiKey, publicApiKey } from "~/lib/ledger";
import { apiKeys, users } from "~/lib/schema";

function parseId(raw: string | undefined) {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** name 可选、最长 64；expires_at 可选，非法时间回 400 而不是静默忽略 */
function parseKeyInput(body: Record<string, unknown> | null) {
  let name: string | null = null;
  if (body?.name !== undefined && body?.name !== null) {
    name = String(body.name).trim() || null;
    if (name && name.length > 64) return { error: "密钥名称不能超过 64 字" } as const;
  }

  let expiresAt: Date | null = null;
  if (body?.expires_at !== undefined && body?.expires_at !== null && String(body.expires_at) !== "") {
    const parsed = new Date(String(body.expires_at));
    if (Number.isNaN(parsed.getTime())) return { error: "expires_at 不是合法时间" } as const;
    expiresAt = parsed;
  }

  return { name, expiresAt } as const;
}

/** GET /api/admin/users/{id}/api_keys —— 用户不存在时回空列表，不报 404 */
export async function GET({ request, params }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const id = parseId(params.id);
  if (!id) return errorJson("用户 id 不合法", 400);

  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, id))
    .orderBy(desc(apiKeys.createdAt));

  return json({ items: rows.map(publicApiKey), total: rows.length });
}

/**
 * POST /api/admin/users/{id}/api_keys —— 给用户签发密钥。
 *
 * 响应手写而不是用 publicApiKey：key 是明文，只在这一个响应里出现一次，
 * hash 之后库里再也取不回原文，管理员得当场把明文交给用户。
 */
export async function POST({ request, params }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const id = parseId(params.id);
  if (!id) return errorJson("用户 id 不合法", 400);

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (!user) return errorJson("用户不存在", 404);

  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  const input = parseKeyInput(body);
  if ("error" in input) return errorJson(input.error, 400);

  const key = generateApiKey();
  const now = new Date();
  const [created] = await db
    .insert(apiKeys)
    .values({
      userId: id,
      name: input.name,
      keyHash: key.hash,
      keyPrefix: key.prefix,
      keySuffix: key.suffix,
      status: 1,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .$returningId();

  return json({
    data: {
      id: created.id,
      name: input.name,
      key: key.plain,
      key_prefix: key.prefix,
      expires_at: input.expiresAt,
    },
  });
}
