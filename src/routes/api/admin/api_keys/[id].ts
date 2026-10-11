import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { apiKeys } from "~/lib/schema";

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
