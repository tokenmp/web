import type { APIEvent } from "@solidjs/start/server";

import { guardUser } from "~/lib/api-auth";
import { errorJson, json } from "~/lib/http";
import { usageSeries } from "~/lib/records";

/**
 * GET /api/user/usage
 *
 * 我的用量趋势，按天升序。days 默认 30，取值 1 到 90，超出返回 400
 * （管理端的 /admin/dashboard/usage 是回落到默认值，这条按 openapi 是报错）。
 *
 * 响应形状照 UsageSeriesItem：{ data: { series: [{ date, requests, tokens, revenue, models }] } }。
 */
export async function GET({ request }: APIEvent) {
  const guard = await guardUser(request);
  if ("error" in guard) return guard.error;

  const url = new URL(request.url);
  const rawDays = url.searchParams.get("days");

  let days = 30;
  if (rawDays !== null && rawDays !== "") {
    const parsed = Number(rawDays);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 90) {
      return errorJson("days 必须是 1 到 90 之间的整数", 400);
    }
    days = parsed;
  }

  const series = await usageSeries({ days, userId: guard.user.id });
  return json({ data: { series } });
}
