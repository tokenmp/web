import type { APIEvent } from "@solidjs/start/server";

import { clearSessionCookie } from "~/lib/auth";
import { json } from "~/lib/http";

/**
 * POST /api/auth/logout
 *
 * 会话是无状态 JWT，服务端没东西可清，把 cookie 抹掉就够了。
 */
export async function POST({ request }: APIEvent) {
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie(request) });
}
