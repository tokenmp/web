import { eq } from "drizzle-orm";

import { readSessionCookie, verifySession } from "./auth";
import { db } from "./db";
import { users, type UserRow } from "./schema";

/**
 * API 路由里读当前用户，读不到返回 null。
 *
 * 和 src/lib/session.ts 的 getCurrentUser 是同一条判断链，区别是那个是 server function、
 * 用 getRequestEvent 拿请求；这里是普通 API 路由，从传进来的 request 拿 cookie。
 */
export async function requireUser(request: Request): Promise<UserRow | null> {
  const token = readSessionCookie(request);
  if (!token) return null;

  const session = await verifySession(token);
  if (!session) return null;

  const [user] = await db.select().from(users).where(eq(users.id, session.sub)).limit(1);
  if (!user) return null;
  if (user.status !== 1) return null;
  if (user.tokenVersion !== session.tv) return null;

  return user;
}

/** 管理端接口用：必须是 role=admin */
export async function requireAdmin(request: Request): Promise<UserRow | null> {
  const user = await requireUser(request);
  if (!user || user.role !== "admin") return null;
  return user;
}
