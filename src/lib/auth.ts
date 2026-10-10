import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";

import type { UserRow } from "./schema";

const SESSION_COOKIE = "tokenmp_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 天

function secret() {
  const value = process.env.SESSION_SECRET ?? "tokenmp-dev-secret-change-me";
  if (process.env.NODE_ENV === "production" && value === "tokenmp-dev-secret-change-me") {
    throw new Error("生产环境必须设置 SESSION_SECRET");
  }
  return new TextEncoder().encode(value);
}

/* ------------------------------------------------------------------ 密码 */

/** 注册时用。cost 取 10，跟线上 sales 用户一致。 */
export function hashPassword(plain: string) {
  return bcrypt.hashSync(plain, 10);
}

/**
 * 校验线上导进来的密码哈希。
 *
 * 库里的哈希有 $2y$12$、$2b$10$、$2a$10$ 三种前缀（$2y$ 是 PHP crypt 的风格，
 * 线上那套是 Go 写的、早期数据可能来自 PHP 系统）。纯 ASCII 密码下三者算法一致，
 * bcryptjs 三种都能验证，已经用真实哈希逐条确认过。
 *
 * 哈希格式不对时 compareSync 会抛错，这里吞掉返回 false，不让它变成 500。
 */
export function verifyPassword(plain: string, hash: string) {
  if (!plain || !hash) return false;
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ 会话 */

export interface SessionPayload {
  /** users.id */
  sub: number;
  /** 签发时的 users.token_version */
  tv: number;
  role: string;
}

export async function signSession(payload: SessionPayload) {
  return new SignJWT({ tv: payload.tv, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(payload.sub))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    const sub = Number(payload.sub);
    if (!Number.isFinite(sub)) return null;
    return { sub, tv: Number(payload.tv ?? 0), role: String(payload.role ?? "user") };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- cookie 读写 */

export function sessionCookie(token: string, maxAge = SESSION_MAX_AGE) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    // 本地是 http，只有生产才加 Secure
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
}

export function clearSessionCookie() {
  return sessionCookie("", 0);
}

export function readSessionCookie(request: Request) {
  const raw = request.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * 对外返回的用户信息，永远不含 password_hash。
 *
 * created_at 也放出去：个人中心要显示「注册于」，而线上 /auth/me 的
 * user 对象里本来就有它。
 */
export function publicUser(user: UserRow) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    source: user.source,
    created_at: user.createdAt,
  };
}
