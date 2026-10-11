/**
 * 客户端调本机接口的统一入口。
 *
 * 原来这套封装埋在 src/lib/system.ts 里，只有它自己用。业务页面接后端时要复用同一套
 * 错误处理与信封解包，所以抽到这里，system.ts 改为从这里导入。
 *
 * 口径：
 *   - 成功单对象 `{ data }`，用 getData / postData 之类取 data
 *   - 成功列表 `{ items, total }`，用 getList 取
 *   - 纯成功 `{ ok: true }`，用 postOk
 *   - 失败 `{ error: "一句话" }`，HTTP 状态码在 ApiError.status 上
 *
 * 唯一的例外是 /api/user/credits，它的 total 在 data 里，不用 getList。
 */

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** 底层请求。错误信封是 {error}，取出来当异常信息，调用方不用每处判 res.ok */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");

  const res = await fetch(path, { ...init, headers });
  const payload: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `请求失败（${res.status}）`;
    throw new ApiError(message, res.status);
  }

  return payload as T;
}

/** 拼查询串，值为 undefined / null / 空串的丢掉 */
export function query(params: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/* --------------------------------------------------------------- 单对象 */

/** GET，返回 data 里的对象 */
export async function getData<T>(path: string): Promise<T> {
  const body = await request<{ data: T }>(path);
  return body.data;
}

/** GET，返回 { items, total }。列表端点的 total 在顶层 */
export function getList<T>(path: string) {
  return request<{ items: T[]; total: number }>(path);
}

/** POST，返回 data 里的对象 */
export async function postData<T>(path: string, input?: unknown): Promise<T> {
  const body = await request<{ data: T }>(path, {
    method: "POST",
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  return body.data;
}

/** PUT，返回 data 里的对象 */
export async function putData<T>(path: string, input?: unknown): Promise<T> {
  const body = await request<{ data: T }>(path, {
    method: "PUT",
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  return body.data;
}

/** PATCH，返回 data 里的对象 */
export async function patchData<T>(path: string, input?: unknown): Promise<T> {
  const body = await request<{ data: T }>(path, {
    method: "PATCH",
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  return body.data;
}

/* ------------------------------------------------------------ 只要 ok */

export function postOk(path: string, input?: unknown) {
  return request<{ ok: boolean }>(path, {
    method: "POST",
    body: input === undefined ? undefined : JSON.stringify(input),
  });
}

export function putOk(path: string, input?: unknown) {
  return request<{ ok: boolean }>(path, {
    method: "PUT",
    body: input === undefined ? undefined : JSON.stringify(input),
  });
}

export function patchOk(path: string, input?: unknown) {
  return request<{ ok: boolean }>(path, {
    method: "PATCH",
    body: input === undefined ? undefined : JSON.stringify(input),
  });
}

export function deleteOk(path: string) {
  return request<{ ok: boolean }>(path, { method: "DELETE" });
}
