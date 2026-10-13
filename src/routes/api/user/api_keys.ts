import type { APIEvent } from "@solidjs/start/server";
import { and, desc, eq } from "drizzle-orm";

import { requireUser } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { generateApiKey, publicApiKey } from "~/lib/ledger";
import { apiKeys } from "~/lib/schema";
import { checkInt32 } from "~/lib/validate";

/** name 可选、最长 64；expires_at 可选，非法时间回 400 */
type KeyInput = { name: string | null; expiresAt: Date | null } | { error: string };

// 返回类型要显式写出来。靠 `as const` 推的话，两条 return 的联合在调用处
// `"error" in input` 之后收不窄，`input.error` 会是 `string | undefined`。
function parseKeyInput(body: Record<string, unknown> | null): KeyInput {
  let name: string | null = null;
  if (body?.name !== undefined && body?.name !== null) {
    name = String(body.name).trim() || null;
    if (name && name.length > 64) return { error: "密钥名称不能超过 64 字" };
  }

  let expiresAt: Date | null = null;
  if (body?.expires_at !== undefined && body?.expires_at !== null && String(body.expires_at) !== "") {
    const parsed = new Date(String(body.expires_at));
    if (Number.isNaN(parsed.getTime())) return { error: "expires_at 不是合法时间" };
    expiresAt = parsed;
  }

  return { name, expiresAt };
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

/* --------------------------------------------------- 可编辑属性（PATCH） */

/**
 * 密钥可编辑属性的解析器。三个 PATCH 端点共用一份：
 *
 *   PATCH /user/api_keys/{id}              用户改自己的
 *   PATCH /admin/api_keys/{id}             管理员改任意一把
 *   PATCH /admin/users/{id}/api_keys       管理员改某用户名下的（key_id 放 body）
 *
 * 只改请求体里出现过的字段，判断用 `!== undefined` —— `null` 是有意义的输入，
 * 表示把这一列清空，`??` 会把它当成没传。三个字段的语义：
 *
 *   status              只认数字 0 / 1。绝不用 Number() 强转：
 *                       status=true 会变成 1、status=null 会变成 0，
 *                       前者把停用请求当成了启用，后者把启用请求静默停用
 *   name                字符串，最长 64；空串与 null 都是清空
 *   expires_at          合法时间字符串；空串与 null 都表示永不过期
 *   model_whitelist     字符串数组或 null。每项非空、最长 128、最多 200 项
 *   rate_limit_per_min  非负整数或 null（不限速）。上限按 INT 列，用 checkInt32 挡
 */
export function parseApiKeyPatch(body: Record<string, unknown> | null):
  | { patch: Record<string, unknown> }
  | { error: string } {
  const patch: Record<string, unknown> = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return { patch };

  if (body.status !== undefined) {
    if (typeof body.status !== "number" || (body.status !== 0 && body.status !== 1)) {
      return { error: "status 只能是数字 0 或 1" };
    }
    patch.status = body.status;
  }

  if (body.name !== undefined) {
    if (body.name === null) {
      patch.name = null;
    } else {
      if (typeof body.name !== "string") return { error: "密钥名称必须是字符串" };
      const name = body.name.trim();
      if (name.length > 64) return { error: "密钥名称不能超过 64 字" };
      patch.name = name || null;
    }
  }

  if (body.expires_at !== undefined) {
    if (body.expires_at === null || body.expires_at === "") {
      patch.expiresAt = null;
    } else {
      if (typeof body.expires_at !== "string") return { error: "expires_at 必须是字符串" };
      const parsed = new Date(body.expires_at);
      if (Number.isNaN(parsed.getTime())) return { error: "expires_at 不是合法时间" };
      patch.expiresAt = parsed;
    }
  }

  if (body.model_whitelist !== undefined) {
    if (body.model_whitelist === null) {
      patch.modelWhitelist = null;
    } else {
      if (!Array.isArray(body.model_whitelist)) {
        return { error: "model_whitelist 必须是字符串数组" };
      }
      const list: string[] = [];
      for (const item of body.model_whitelist) {
        if (typeof item !== "string") return { error: "model_whitelist 的每一项必须是字符串" };
        const model = item.trim();
        if (!model) return { error: "model_whitelist 不能包含空字符串" };
        if (model.length > 128) return { error: "model_whitelist 的模型名不能超过 128 字" };
        list.push(model);
      }
      if (list.length > 200) return { error: "model_whitelist 最多 200 项" };
      patch.modelWhitelist = list;
    }
  }

  if (body.rate_limit_per_min !== undefined) {
    if (body.rate_limit_per_min === null) {
      patch.rateLimitPerMin = null;
    } else {
      const value = body.rate_limit_per_min;
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return { error: "rate_limit_per_min 必须是整数" };
      }
      const problem = checkInt32(value, "rate_limit_per_min");
      if (problem) return { error: problem };
      if (value < 0) return { error: "rate_limit_per_min 不能是负数" };
      patch.rateLimitPerMin = value;
    }
  }

  return { patch };
}

/**
 * 按 id 更新一把密钥，返回改完的 publicApiKey 形状。
 *
 * scope.userId 传了就是用户端：where 里额外带上 user_id，改别人的密钥会命中 0 行、
 * 当作不存在回 404 —— 与 DELETE 一样，不让 403/404 的差别被拿来探测别人的密钥 id。
 * 不传就是管理端，直接按 id 改（密钥 id 全局唯一）。
 */
export async function patchApiKey(
  id: number,
  body: Record<string, unknown> | null,
  scope: { userId?: number } = {},
): Promise<Response> {
  const parsed = parseApiKeyPatch(body);
  if ("error" in parsed) return errorJson(parsed.error, 400);
  if (Object.keys(parsed.patch).length === 0) return errorJson("没有可更新的字段", 400);

  const where =
    scope.userId === undefined
      ? eq(apiKeys.id, id)
      : and(eq(apiKeys.id, id), eq(apiKeys.userId, scope.userId));

  const [result] = await db
    .update(apiKeys)
    .set({ ...parsed.patch, updatedAt: new Date() })
    .where(where);
  if (result.affectedRows === 0) return errorJson("密钥不存在", 404);

  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
  if (!row) return errorJson("密钥不存在", 404);
  return json({ data: publicApiKey(row) });
}
