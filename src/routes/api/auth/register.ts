import type { APIEvent } from "@solidjs/start/server";
import { eq, or } from "drizzle-orm";

import { hashPassword, publicUser, sessionCookie, signSession } from "~/lib/auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { users } from "~/lib/schema";

/**
 * POST /api/auth/register
 *
 * 请求体：{ email, password, name? }
 *
 * 跟线上不一样的地方：线上是先 /auth/send-code 发邮箱验证码再注册，
 * 本地没有邮件服务，所以跳过了验证码这一步。接入真实邮件之前，
 * 这个接口只适合开发环境用。
 */
export async function POST({ request }: APIEvent) {
  let body: { email?: unknown; password?: unknown; name?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorJson("邮箱格式不正确", 400);
  if (password.length < 8) return errorJson("密码至少 8 位", 400);
  // bcrypt 只看前 72 字节，超长密码会被静默截断，这里直接拦掉
  if (Buffer.byteLength(password, "utf8") > 72) return errorJson("密码过长", 400);

  const name = (String(body?.name ?? "").trim() || email.split("@")[0]).slice(0, 64);

  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, email), eq(users.name, name)))
    .limit(1);
  if (taken) return errorJson("邮箱或用户名已被占用", 409);

  const now = new Date();
  const [created] = await db
    .insert(users)
    .values({
      name,
      email,
      passwordHash: hashPassword(password),
      role: "user",
      status: 1,
      tokenVersion: 0,
      source: "local",
      createdAt: now,
      updatedAt: now,
    })
    .$returningId();

  const [user] = await db.select().from(users).where(eq(users.id, created.id)).limit(1);
  const token = await signSession({ sub: user.id, tv: user.tokenVersion, role: user.role });

  return json({ token, user: publicUser(user) }, 201, { "set-cookie": sessionCookie(token) });
}
