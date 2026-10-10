"use server";

import { eq } from "drizzle-orm";
import { getRequestEvent } from "solid-js/web";

import { publicUser, readSessionCookie, verifySession } from "./auth";
import { db } from "./db";
import { users } from "./schema";

/**
 * 读当前登录用户，读不到就返回 null。
 *
 * 这是 server function，可以直接在组件里 await 调用 —— 它在服务端跑，
 * 能拿到请求的 cookie，也因此在 SSR 阶段就能判断登录状态，不用等客户端再补一次请求。
 *
 * 返回值必须是可序列化的，所以只回 publicUser 那几个字段。
 */
export async function getCurrentUser() {
  const event = getRequestEvent();
  if (!event) return null;

  const token = readSessionCookie(event.request);
  if (!token) return null;

  const session = await verifySession(token);
  if (!session) return null;

  const [user] = await db.select().from(users).where(eq(users.id, session.sub)).limit(1);
  if (!user) return null;
  if (user.status !== 1) return null;
  // 改过密码就会对不上，强制重新登录
  if (user.tokenVersion !== session.tv) return null;

  return publicUser(user);
}
