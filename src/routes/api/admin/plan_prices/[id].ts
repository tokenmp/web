import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { planPrices } from "~/lib/schema";

function parseId(raw: string | undefined) {
  const id = Number(raw);
  // 必须是整数：1.5 以前算合法 id 然后查不到，回了 404；
  // openapi 把非整数归 400，两者要分得开
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * DELETE /api/admin/plan_prices/{id}
 *
 * 硬删一条模型价。openapi 只列了 200，没列 404，所以删不存在的也回 200 ——
 * 删除是幂等的，重试一次不该报错。
 */
export async function DELETE({ request, params }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const id = parseId(params.id);
  if (!id) return errorJson("定价 id 不合法", 400);

  await db.delete(planPrices).where(eq(planPrices.id, id));
  return json({ ok: true });
}
