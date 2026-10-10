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
