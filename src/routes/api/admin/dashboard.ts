import type { APIEvent } from "@solidjs/start/server";

import { guardAdmin } from "~/lib/api-auth";
import { json } from "~/lib/http";
import { dashboardSummary, toDashboardUsage, usageSeries } from "~/lib/records";

/**
 * GET /api/admin/dashboard
 *
 * openapi 把概览拆成 /dashboard/summary 与 /dashboard/usage 两条，这里额外提供一条
 * 合并入口，让控制台概览页一次请求就能把四个指标与趋势图都拿到。
 * 属于本机扩展；两条标准端点（dashboard/summary.ts、dashboard/usage.ts）同样可用。
 */
export async function GET({ request }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;

  const url = new URL(request.url);
  const rawDays = url.searchParams.get("days");

  let days = 7;
  if (rawDays !== null && rawDays !== "") {
    const parsed = Number(rawDays);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 90) days = parsed;
  }

  const [summary, series] = await Promise.all([dashboardSummary(), usageSeries({ days })]);

  return json({
    data: {
      summary,
      usage: { days, total: series.length, items: toDashboardUsage(series) },
    },
  });
}
