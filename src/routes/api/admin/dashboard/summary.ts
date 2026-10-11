import type { APIEvent } from "@solidjs/start/server";

import { guardAdmin } from "~/lib/api-auth";
import { json } from "~/lib/http";
import { dashboardSummary } from "~/lib/records";

/**
 * GET /api/admin/dashboard/summary
 *
 * 概览指标，统计窗口固定最近 24 小时（openapi 明写不可调）：
 * requests / success / success_rate / cost / revenue，外加余额加信用不大于 0 的启用用户数。
 */
export async function GET({ request }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;

  const data = await dashboardSummary();
  return json({ data });
}
