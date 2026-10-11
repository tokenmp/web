import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { duplicateMessageFor } from "~/lib/db-error";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { plans } from "~/lib/schema";

/**
 * POST /api/admin/plans/{id}/enable
 *
 * 把软删（status=0）的套餐恢复上架。恢复是独立动作：整体替换的 PUT 不收 status，
 * 所以按公告那边 /publish、/archive 的路子单开一个端点，不塞进 PUT。
 *
 * 已经是 status=1 时也回 200：重复点一下不该报错（幂等）。
 * name 上挂着唯一索引，软删的套餐仍占着名字，正常恢复不会撞；真撞上就翻成 409，不是 500。
 */
export async function POST({ request, params }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return errorJson("套餐 id 不合法", 400);

  const [row] = await db
    .select({ id: plans.id, status: plans.status })
    .from(plans)
    .where(eq(plans.id, id))
    .limit(1);
  if (!row) return errorJson("套餐不存在", 404);

  // 幂等：已经在售就不再写库，直接回成功
  if (row.status === 1) return json({ ok: true });

  try {
    await db
      .update(plans)
      .set({ status: 1, updatedAt: new Date() })
      .where(eq(plans.id, id));
  } catch (err) {
    // 恢复本身不改 name，但并发改名之类仍可能撞唯一键，翻成 409
    const dup = duplicateMessageFor(err, {}, "套餐名已被占用");
    if (dup) return errorJson(dup, 409);
    throw err;
  }

  return json({ ok: true });
}
