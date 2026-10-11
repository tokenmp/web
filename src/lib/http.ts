export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function errorJson(message: string, status = 400, headers: Record<string, string> = {}) {
  return json({ error: message }, status, headers);
}

/**
 * 把 drizzle 返回的行转成 snake_case。
 *
 * drizzle 的行用 JS 属性名（actionLabel），而对外接口统一用 snake_case（action_label）——
 * 线上是这个风格，users 那几个接口的 publicUser 也是手写的 snake_case。
 * 不加这一步，前端从两个接口拿到同一含义的字段会是两个名字。
 */
export function toSnake<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/[A-Z]/g, ch => `_${ch.toLowerCase()}`)] = value;
  }
  return out;
}

/**
 * 分页参数。线上是 `page` 与 `size`（注意是 size，不是 page_size），
 * 响应把 items 与 total 放在顶层。非法值一律回落到默认值，不报错。
 */
export function parsePaging(url: URL, defaultSize = 20) {
  const rawPage = Number(url.searchParams.get("page") ?? 1);
  const rawSize = Number(url.searchParams.get("size") ?? defaultSize);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const size = Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(100, Math.floor(rawSize)) : defaultSize;
  return { page, size, offset: (page - 1) * size };
}

/**
 * drizzle 的 decimal 列回来的是字符串（DECIMAL(14,8) 精度超过 JS 安全整数时会失真，
 * 所以驱动不转）。对外接口统一给数字，这里收口转换；null 与非法值都回 0。
 */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
