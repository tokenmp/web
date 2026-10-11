import type { APIEvent } from "@solidjs/start/server";

import { guardAdmin } from "~/lib/api-auth";
import { json } from "~/lib/http";
import { requestRecordFilters } from "~/lib/records";

/**
 * GET /api/admin/request-records/filters（openapi 写作 /admin/request_records/filters）
 *
 * 全站调用记录里出现过的模型与 user agent。响应用 data，不是 items。
 */
export async function GET({ request }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;

  const data = await requestRecordFilters();
  return json({ data });
}
