import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { apiKeys } from "~/lib/schema";
import { patchApiKey } from "~/routes/api/user/api_keys";

function parseId(raw: string | undefined) {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * DELETE /api/admin/api_keys/{id}
 *
 * 硬删。密钥表不参与对账，留着一把已经不该用的密钥只有风险没有价值；
 * 网关那边靠 key_hash 查不到记录就当作无效密钥。
 * 不存在也回成功 —— 幂等，重复点删除不会报错。
 */
export async function DELETE({ request, params }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const id = parseId(params.id);
  if (!id) return errorJson("密钥 id 不合法", 400);

  await db.delete(apiKeys).where(eq(apiKeys.id, id));
  return json({ ok: true });
}

/**
 * PATCH /api/admin/api_keys/{id}
 *
 * 管理员改任意一把密钥的属性。与用户端同一份解析（parseApiKeyPatch），
 * 区别只在范围：不带 user_id 过滤，密钥 id 全局唯一。
 * 不存在回 404（不像 DELETE 那样幂等）—— 改一个不存在的对象不能假装成功。
 */
export async function PATCH({ request, params }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;

  const id = parseId(params.id);
  if (!id) return errorJson("密钥 id 不合法", 400);

  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  return patchApiKey(id, body);
}
