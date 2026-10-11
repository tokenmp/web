import type { APIEvent } from "@solidjs/start/server";
import { eq, sql } from "drizzle-orm";

import { guardUser } from "~/lib/api-auth";
import { hashPassword, sessionCookie, signSession, verifyPassword } from "~/lib/auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { users } from "~/lib/schema";

/**
 * POST /api/auth/password
 *
 * 请求体：{ old_password: string, new_password: string }
 * 新密码至少 8 位、至多 72 字节 —— 与注册同一口径（bcrypt 只看前 72 字节）。
 *
 * 会话策略：当前这台重新签发，其他设备全部失效。
 *
 * users.token_version 加一之后，所有已签发的 JWT 都会在 requireUser / getCurrentUser
 * 的 tv 比对处失效。如果连当前这台也一并失效，用户改完密码立刻被踢回登录页，
 * 体验很糟（而且他刚刚才证明过自己知道旧密码）。所以这里用**改完之后**的 token_version
 * 新签一个 token，并像 login 那样写回 httpOnly cookie：当前浏览器无缝续上，其他设备下次
 * 请求拿到 401，必须用新密码重新登录。
 *
 * 响应的 data.token 与 login 一致，给非 cookie 客户端（比如把 token 存在别处）留一条路。
 */
export async function POST({ request }: APIEvent) {
  const guard = await guardUser(request);
  if ("error" in guard) return guard.error;
  const user = guard.user;

  let body: { old_password?: unknown; new_password?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  const oldPassword = String(body?.old_password ?? "");
  const newPassword = String(body?.new_password ?? "");

  if (!oldPassword || !newPassword) return errorJson("请填写原密码与新密码", 400);
  if (newPassword.length < 8) return errorJson("密码至少 8 位", 400);
  // 与注册一致：bcrypt 只看前 72 字节，超长密码会被静默截断
  if (Buffer.byteLength(newPassword, "utf8") > 72) return errorJson("密码过长", 400);

  // 旧密码错不区分「用户不存在」和「密码不对」，避免被拿来试探
  if (!verifyPassword(oldPassword, user.passwordHash)) {
    return errorJson("原密码不正确", 400);
  }

  await db
    .update(users)
    .set({
      passwordHash: hashPassword(newPassword),
      // 相对写入而不是写死 user.tokenVersion + 1：并发改密码时不会把版本号覆盖回去
      tokenVersion: sql`token_version + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // 重新读一次拿自增后的版本号，保证签出来的 token 跟库里的完全一致
  const [fresh] = await db
    .select({ tokenVersion: users.tokenVersion })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const token = await signSession({
    sub: user.id,
    tv: fresh?.tokenVersion ?? user.tokenVersion + 1,
    role: user.role,
  });

  return json({ data: { token } }, 200, { "set-cookie": sessionCookie(token) });
}
