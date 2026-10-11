import type { APIEvent } from "@solidjs/start/server";

import { guardAdmin } from "~/lib/api-auth";
import { json, parsePaging } from "~/lib/http";
import { listRequestRecords, parseDateParam } from "~/lib/records";

/** 查询参数里的可选正整数，非法（含 0 与负数）就当没传 */
function optionalId(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * GET /api/admin/request-records（openapi 写作 /admin/request_records）
 *
 * 全站的调用记录。比用户端多 user_id 筛选与 sort / order。
 * sort 只认 openapi 列出的几个字段，order 只认 asc（其余按 desc）。
 */
export async function GET({ request }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;

  const url = new URL(request.url);
  const { size, offset } = parsePaging(url);

  const { items, total } = await listRequestRecords({
    userId: optionalId(url.searchParams.get("user_id")),
    keyword: url.searchParams.get("keyword"),
    model: url.searchParams.get("model"),
    userAgent: url.searchParams.get("user_agent"),
    status: url.searchParams.get("status"),
    errorCode: url.searchParams.get("error_code"),
    start: parseDateParam(url.searchParams.get("start")),
    end: parseDateParam(url.searchParams.get("end")),
    sort: url.searchParams.get("sort"),
    order: url.searchParams.get("order"),
    size,
    offset,
  });

  return json({ ok: true, items, total });
}
