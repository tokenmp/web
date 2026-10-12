import type { APIEvent } from "@solidjs/start/server";

import { lookupApiKey } from "~/lib/api-key-lookup";
import { checkRecordsSecret } from "~/lib/callback-secret";
import { errorJson, json } from "~/lib/http";
import { checkText } from "~/lib/validate";

/**
 * 转发内核校验客户端密钥：输入密钥明文，输出身份、限流白名单与计价口径。
 *
 * 不走会话，用 x-callback-secret 共享密钥（RECORDS_CALLBACK_SECRET，与记录摄入同一把）。
 * 密钥明文只放请求体，不放 URL —— URL 会进访问日志。
 *
 * 失败分三种：密钥不存在 404、密钥或账号停用 403、密钥过期 410。
 * 内核据此决定拦不拦，本机不做这个判断。
 */
export async function POST({ request }: APIEvent) {
  const denied = checkRecordsSecret(request, errorJson);
  if (denied) return denied;

  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  const problem = checkText(body?.key, "key", 128);
  if (problem) return errorJson(problem, 400);

  const result = await lookupApiKey((body?.key as string).trim());
  if (!result.ok) {
    switch (result.reason) {
      case "unknown_key":
        return errorJson("密钥不存在", 404);
      case "key_disabled":
        return errorJson("密钥已停用", 403);
      case "user_disabled":
        return errorJson("账号已停用", 403);
      case "expired":
        return errorJson("密钥已过期", 410);
    }
  }

  return json({ ok: true, data: result.data });
}
