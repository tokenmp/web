import type { APIEvent } from "@solidjs/start/server";
import { and, eq } from "drizzle-orm";

import { requireUser } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { apiKeys } from "~/lib/schema";

import { patchApiKey } from "../api_keys";

function parseId(raw: string | undefined) {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * DELETE /api/user/api_keys/{id}
 *
 * 条件里必须同时带 user_id：只按 id 删的话，任何登录用户都能拿别人的
 * 密钥 id 把它删掉。查不到（不存在，或属于别人）都当作不存在回 404，
 * 免得 403 与 404 的差别被人拿来探测别人的密钥 id。
 */
export async function DELETE({ request, params }: APIEvent) {
  const user = await requireUser(request);
  if (!user) return errorJson("请先登录", 401);

  const id = parseId(params.id);
  if (!id) return errorJson("密钥 id 不合法", 400);

  const [result] = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)));
  if (result.affectedRows === 0) return errorJson("密钥不存在", 404);

  return json({ ok: true });
}

/**
 * PATCH /api/user/api_keys/{id}
 *
 * 改自己密钥的属性（停用/改名/改过期时间/白名单/限速）。删是硬删、删了历史就查不到，
 * 想留痕就把 status 置 0。
 *
 * 属性解析与入库共用 api_keys.ts 里的 parseApiKeyPatch / patchApiKey，
 * 这里额外传 user_id 限定范围：改别人的密钥命中 0 行，按不存在回 404。
 */
export async function PATCH({ request, params }: APIEvent) {
  const user = await requireUser(request);
  if (!user) return errorJson("请先登录", 401);

  const id = parseId(params.id);
  if (!id) return errorJson("密钥 id 不合法", 400);

  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  return patchApiKey(id, body, { userId: user.id });
}
