export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function errorJson(message: string, status = 400, headers: Record<string, string> = {}) {
  return json({ error: message }, status, headers);
}
