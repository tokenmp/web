import type { APIEvent } from "@solidjs/start/server";
import { eq, or } from "drizzle-orm";

import { publicUser, sessionCookie, signSession, verifyPassword } from "~/lib/auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { users } from "~/lib/schema";

/**
 * POST /api/auth/login
 *
 * 请求体：{ email: string, password: string }
 *   email 这一栏同时接受邮箱和用户名 —— 线上两套用户表的登录名不一样：
 *   postgres 那 261 个用户用邮箱，mysql sales 的管理员用 name。
 *
 * 响应：{ token, user }，与线上 Go 后端的 /auth/login 对齐，
 * 同时把 token 写进 httpOnly cookie，SSR 那一侧可以直接读。
 */
export async function POST({ request }: APIEvent) {
  let body: { email?: unknown; username?: unknown; password?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  const identifier = String(body?.email ?? body?.username ?? "").trim();
  const password = String(body?.password ?? "");

  if (!identifier || !password) return errorJson("请填写账号和密码", 400);

  const [user] = await db
    .select()
    .from(users)
    .where(or(eq(users.email, identifier), eq(users.name, identifier)))
    .limit(1);

  // 用户不存在和密码错误返回同一句话，避免被拿来枚举账号
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return errorJson("账号或密码不正确", 401);
  }

  if (user.status !== 1) return errorJson("账号已停用，请联系管理员", 403);

  const token = await signSession({ sub: user.id, tv: user.tokenVersion, role: user.role });

  return json({ token, user: publicUser(user) }, 200, { "set-cookie": sessionCookie(token) });
}
