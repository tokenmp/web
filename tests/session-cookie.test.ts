/**
 * 会话 cookie 的 Secure 属性。
 *
 * 起因：Secure 原来按 `NODE_ENV === "production"` 决定。本机 6789 上是 http 直连，
 * 也跑着 `NODE_ENV=production` 的正式构建，于是登录接口带着 Secure 下发 cookie，
 * 浏览器在 http://r86s.local:6789 上直接把它丢掉 —— 登录成功，但进 /dashboard 又被
 * 守卫弹回登录页。localhost 与 127.0.0.1 被浏览器当成可信来源，所以在服务器本机
 * 或 curl 里测都看不出这个毛病，只有换成局域网里的域名才会暴露。
 *
 * 现在按请求实际的协议判断：请求本身是 https，或者前面的反向代理留下
 * `x-forwarded-proto: https`（线上 tokenmp.top 就是这种），才加 Secure。
 *
 *   bun test tests/session-cookie.test.ts
 */
import { describe, expect, test } from "bun:test";

import { clearSessionCookie, sessionCookie } from "../src/lib/auth";

function request(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe("会话 cookie 的 Secure 属性", () => {
  test("http 请求不带 Secure", () => {
    const cookie = sessionCookie("tok", request("http://r86s.local:6789/api/auth/login"));
    expect(cookie).not.toContain("Secure");
  });

  test("https 请求带 Secure", () => {
    const cookie = sessionCookie("tok", request("https://tokenmp.top/api/auth/login"));
    expect(cookie).toContain("Secure");
  });

  test("反向代理终结 TLS 时按 x-forwarded-proto 判断", () => {
    const forwarded = sessionCookie(
      "tok",
      request("http://127.0.0.1:6789/api/auth/login", { "x-forwarded-proto": "https" }),
    );
    expect(forwarded).toContain("Secure");

    const plain = sessionCookie(
      "tok",
      request("http://127.0.0.1:6789/api/auth/login", { "x-forwarded-proto": "http" }),
    );
    expect(plain).not.toContain("Secure");
  });

  test("多个代理串起来时只看第一个协议", () => {
    const cookie = sessionCookie(
      "tok",
      request("http://127.0.0.1:6789/api/auth/login", { "x-forwarded-proto": "https, http" }),
    );
    expect(cookie).toContain("Secure");
  });

  test("清 cookie 的属性跟着种 cookie 走，否则浏览器不肯删", () => {
    const secured = clearSessionCookie(request("https://tokenmp.top/api/auth/logout"));
    expect(secured).toContain("Max-Age=0");
    expect(secured).toContain("Secure");

    const plain = clearSessionCookie(request("http://r86s.local:6789/api/auth/logout"));
    expect(plain).toContain("Max-Age=0");
    expect(plain).not.toContain("Secure");
  });

  test("HttpOnly 与 SameSite 不受影响", () => {
    const cookie = sessionCookie("tok", request("http://r86s.local:6789/api/auth/login"));
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });
});
