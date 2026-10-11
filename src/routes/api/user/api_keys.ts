import type { APIEvent } from "@solidjs/start/server";
import { desc, eq } from "drizzle-orm";

import { requireUser } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { generateApiKey, publicApiKey } from "~/lib/ledger";
import { apiKeys } from "~/lib/schema";

/** name 可选、最长 64；expires_at 可选，非法时间回 400 */
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

/** GET /api/user/api_keys —— 只回自己那几把，且只给前后缀 */
export async function GET({ request }: APIEvent) {
  const user = await requireUser(request);
  if (!user) return errorJson("请先登录", 401);

  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, user.id))
    .orderBy(desc(apiKeys.createdAt));

  return json({ items: rows.map(publicApiKey), total: rows.length });
}

/**
 * POST /api/user/api_keys —— 给自己签一把。
 *
 * 用户 id 只从会话取，请求体里没有 user_id 这一栏 —— 否则等于把越权签发
 * 的口子开在了参数上。明文 key 同样只在此响应出现一次。
 */
export async function POST({ request }: APIEvent) {
  const user = await requireUser(request);
  if (!user) return errorJson("请先登录", 401);

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
      userId: user.id,
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
      key_suffix: key.suffix,
      expires_at: input.expiresAt,
    },
  });
}
