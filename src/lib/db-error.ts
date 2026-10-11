/**
 * 读数据库抛出来的错误。
 *
 * drizzle 0.45 把驱动错误包了一层 `DrizzleQueryError`，真错误在 `err.cause` 里，
 * 外层的 `err.code` 是 undefined。变异测试就是这么暴露出来的：并发建同名用户时
 * 预检查放过去了，走到 insert 撞唯一键，catch 里判 `err.code === "ER_DUP_ENTRY"`
 * 永远判不出来，于是回 500 而不是 409。
 *
 * 所以判驱动错误一律走 `cause`，外层只当兜底。
 */

/** mysql 驱动的错误码，取不到就返回 null */
export function driverErrorCode(err: unknown): string | null {
  const outer = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = outer?.cause?.code ?? outer?.code;
  return typeof code === "string" ? code : null;
}

/** 驱动错误原文，用来判断违反的是哪个唯一键 */
export function driverErrorMessage(err: unknown): string {
  const outer = err as { message?: unknown; cause?: { message?: unknown } } | null;
  const message = outer?.cause?.message ?? outer?.message;
  return typeof message === "string" ? message : "";
}

/** 是不是唯一键冲突（ER_DUP_ENTRY） */
export function isDuplicateEntry(err: unknown) {
  return driverErrorCode(err) === "ER_DUP_ENTRY";
}

/**
 * 唯一键冲突时，按约束名挑一句 409 文案。
 *
 * 传进来的 keyMessages 形如 `{ uk_users_email: "邮箱已存在" }`，
 * 没命中就返回 fallback。
 */
export function duplicateMessageFor(
  err: unknown,
  keyMessages: Record<string, string>,
  fallback: string,
): string | null {
  if (!isDuplicateEntry(err)) return null;
  const message = driverErrorMessage(err);
  for (const [key, text] of Object.entries(keyMessages)) {
    if (message.includes(key)) return text;
  }
  return fallback;
}
