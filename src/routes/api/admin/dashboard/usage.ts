import type { APIEvent } from "@solidjs/start/server";

import { guardAdmin } from "~/lib/api-auth";
import { json } from "~/lib/http";
import { toDashboardUsage, usageSeries } from "~/lib/records";

/**
 * GET /api/admin/dashboard/usage
 *
 * 按天的用量趋势，升序，不分页，total 等于天数。
 * days 取值 1 到 90，超出范围或非法一律回落到 7（与 user/usage 报 400 不同，openapi 这么定的）。
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

  const series = await usageSeries({ days });
  return json({ ok: true, items: toDashboardUsage(series), total: series.length });
}
