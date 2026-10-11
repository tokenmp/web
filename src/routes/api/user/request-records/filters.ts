import type { APIEvent } from "@solidjs/start/server";

import { guardUser } from "~/lib/api-auth";
import { json } from "~/lib/http";
import { requestRecordFilters } from "~/lib/records";

/**
 * GET /api/user/request-records/filters（openapi 写作 /user/request_records/filters）
 *
 * 我的调用记录里出现过的模型与 user agent，给筛选下拉用。响应用 data，不是 items。
 */
export async function GET({ request }: APIEvent) {
  const guard = await guardUser(request);
  if ("error" in guard) return guard.error;

  const data = await requestRecordFilters(guard.user.id);
  return json({ data });
}
