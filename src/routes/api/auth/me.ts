import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";

import { publicUser, readSessionCookie, verifySession } from "~/lib/auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { users } from "~/lib/schema";

/**
 * GET /api/auth/me
 *
 * 从 cookie 里的会话读当前用户。会话有效但用户已被删除、被停用，
 * 或者 token_version 对不上（说明改过密码）时，一律当作未登录。
 */
export async function GET({ request }: APIEvent) {
  const token = readSessionCookie(request);
  if (!token) return errorJson("未登录", 401);

  const session = await verifySession(token);
  if (!session) return errorJson("会话已失效，请重新登录", 401);

  const [user] = await db.select().from(users).where(eq(users.id, session.sub)).limit(1);
  if (!user) return errorJson("账号不存在", 401);
  if (user.status !== 1) return errorJson("账号已停用", 403);
  if (user.tokenVersion !== session.tv) {
    return errorJson("登录状态已失效，请重新登录", 401);
  }

  return json({ user: publicUser(user) });
}
