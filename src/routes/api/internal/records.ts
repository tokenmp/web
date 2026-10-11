import type { APIEvent } from "@solidjs/start/server";

import { errorJson, json } from "~/lib/http";
import { checkCallbackSecret } from "~/lib/recharge";
import { ingestRecords } from "~/lib/records";

/**
 * 转发内核的日志摄入端点。不走会话，用 x-callback-secret 共享密钥。
 *
 * body：{ records?: RequestRecord[], billing?: BillingRecord[] }
 * 一次批量提交；request_id 是幂等键，同一批重复提交只会记一遍，
 * 返回 { ok: true, inserted, skipped, invalid }。
 */
export async function POST({ request }: APIEvent) {
  const denied = checkCallbackSecret(request, errorJson);
  if (denied) return denied;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorJson("请求体必须是对象", 400);
  }

  const payload = body as { records?: unknown; billing?: unknown };
  if (payload.records !== undefined && !Array.isArray(payload.records)) {
    return errorJson("records 必须是数组", 400);
  }
  if (payload.billing !== undefined && !Array.isArray(payload.billing)) {
    return errorJson("billing 必须是数组", 400);
  }

  const result = await ingestRecords(payload);
  return json({ ok: true, ...result });
}
