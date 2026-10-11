import type { APIEvent } from "@solidjs/start/server";

import { guardUser } from "~/lib/api-auth";
import { json, parsePaging } from "~/lib/http";
import { listRequestRecords, parseDateParam } from "~/lib/records";

/**
 * GET /api/user/request-records（openapi 写作 /user/request_records）
 *
 * 我的调用记录。查询参数：page、size、keyword（模糊匹配 model / request_id / user_agent）、
 * model、user_agent、error_code、start、end。
 *
 * 比 openapi 多一个 status：用户面板的请求日志有「成功 / 失败 / 请求中」三个分段，
 * 只靠 keyword 没法实现，所以本机把它作为扩展参数收下（openapi 未定义，缺省不过滤）。
 */
export async function GET({ request }: APIEvent) {
  const guard = await guardUser(request);
  if ("error" in guard) return guard.error;

  const url = new URL(request.url);
  const { size, offset } = parsePaging(url);

  const { items, total } = await listRequestRecords({
    userId: guard.user.id,
    keyword: url.searchParams.get("keyword"),
    model: url.searchParams.get("model"),
    userAgent: url.searchParams.get("user_agent"),
    status: url.searchParams.get("status"),
    errorCode: url.searchParams.get("error_code"),
    start: parseDateParam(url.searchParams.get("start")),
    end: parseDateParam(url.searchParams.get("end")),
    size,
    offset,
  });

  return json({ ok: true, items, total });
}
