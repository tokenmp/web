import type { APIEvent } from "@solidjs/start/server";

import { guardAdmin } from "~/lib/api-auth";
import { json, parsePaging } from "~/lib/http";
import { listBillingRecords, parseDateParam } from "~/lib/records";

/** 查询参数里的可选正整数，非法就当没传 */
function optionalId(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * GET /api/admin/billing-records（openapi 写作 /admin/billing_records）
 *
 * 全站计费流水。查询参数：page、size、user_id、api_key_id、model、channel_name、
 * status（服务端不校验取值）、start、end、sort、order。
 */
export async function GET({ request }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;

  const url = new URL(request.url);
  const { size, offset } = parsePaging(url);

  const { items, total } = await listBillingRecords({
    userId: optionalId(url.searchParams.get("user_id")),
    apiKeyId: optionalId(url.searchParams.get("api_key_id")),
    model: url.searchParams.get("model"),
    channelName: url.searchParams.get("channel_name"),
    status: url.searchParams.get("status"),
    start: parseDateParam(url.searchParams.get("start")),
    end: parseDateParam(url.searchParams.get("end")),
    sort: url.searchParams.get("sort"),
    order: url.searchParams.get("order"),
    size,
    offset,
  });

  return json({ ok: true, items, total });
}
