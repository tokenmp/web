import type { APIEvent } from "@solidjs/start/server";

import { guardUser } from "~/lib/api-auth";
import { json, parsePaging } from "~/lib/http";
import { listBillingRecords, parseDateParam } from "~/lib/records";

/**
 * GET /api/user/billing-records（openapi 写作 /user/billing_records）
 *
 * 我的账单。查询参数：page、size、model、request_id（模糊）、status（success / error）、
 * charge（free / paid）。每项在 BillingRecord 基础上多带 quota_paid 与 balance_paid：
 * 这笔钱是从订阅额度里出的还是从余额里出的，一笔只会落在其中一个口袋。
 */
export async function GET({ request }: APIEvent) {
  const guard = await guardUser(request);
  if ("error" in guard) return guard.error;

  const url = new URL(request.url);
  const { size, offset } = parsePaging(url);

  const { items, total } = await listBillingRecords({
    userId: guard.user.id,
    model: url.searchParams.get("model"),
    requestId: url.searchParams.get("request_id"),
    status: url.searchParams.get("status"),
    charge: url.searchParams.get("charge"),
    start: parseDateParam(url.searchParams.get("start")),
    end: parseDateParam(url.searchParams.get("end")),
    size,
    offset,
    paySplit: true,
  });

  return json({ ok: true, items, total });
}
