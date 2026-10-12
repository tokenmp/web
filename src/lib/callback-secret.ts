/**
 * 内部端点用的共享密钥。
 *
 * 这些端点不由浏览器调用，走不了会话 cookie —— 转发内核和充值渠道的进程里没有登录态。
 * 用环境变量里的共享串做机器对机器的认证，够用且不引新依赖。
 *
 * 分两把：
 *   RECORDS_CALLBACK_SECRET    转发内核用。记录摄入，以及拿客户端密钥换身份与计价口径
 *   RECHARGE_CALLBACK_SECRET   充值渠道回调专用
 * 两边的调用方与权限都不同，一把泄漏时不该让另一条路跟着失守。
 *
 * 没配时只在非生产环境放行（本地开发不配也能跑），并在模块加载（进程启动）时警告一句；
 * 生产环境缺密钥直接拒绝，避免把「能随便给人加钱」的端点暴露出去。两把各自判断。
 */

import { timingSafeEqual } from "node:crypto";

/**
 * 读一个环境变量里的密钥。空串与只有空白的算没配。
 * 警告与错误里只出现变量名，不出现密钥内容，密钥不进日志。
 */
function readSecret(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function recordsCallbackSecret(): string | null {
  return readSecret("RECORDS_CALLBACK_SECRET");
}

export function rechargeCallbackSecret(): string | null {
  return readSecret("RECHARGE_CALLBACK_SECRET");
}

/** 每把密钥在模块加载时各警告一次。生产环境由 scripts/check-env.ts 挡在启动前 */
function warnIfMissing(name: string, read: () => string | null) {
  if (read() || process.env.NODE_ENV === "production") return;
  console.warn(
    `[内部端点] ${name} 没有配置，它保护的端点只在非生产环境放行。生产环境必须设置它。`,
  );
}

warnIfMissing("RECORDS_CALLBACK_SECRET", recordsCallbackSecret);
warnIfMissing("RECHARGE_CALLBACK_SECRET", rechargeCallbackSecret);

/** 定长比较，避免按字符逐位比较泄漏长度与差异位置 */
function secretMatches(got: string, expected: string) {
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 校验内部调用的共享密钥。通过返回 null，不通过返回可以直接 return 的响应。
 *
 * 401 与 403 分开：没带密钥是没认证，带了但不对是认证失败。
 */
function checkSecret(
  request: Request,
  expected: string | null,
  makeError: (message: string, status: number) => Response,
): Response | null {
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return makeError("内部回调密钥未配置，已拒绝调用", 503);
    }
    return null;
  }

  const got = request.headers.get("x-callback-secret");
  if (!got) return makeError("缺少 x-callback-secret 请求头", 401);
  if (!secretMatches(got, expected)) return makeError("x-callback-secret 不正确", 403);
  return null;
}

/** 记录摄入与客户端密钥校验端点共用这一把 */
export function checkRecordsSecret(
  request: Request,
  makeError: (message: string, status: number) => Response,
): Response | null {
  return checkSecret(request, recordsCallbackSecret(), makeError);
}

/** 充值渠道回调专用这一把 */
export function checkRechargeSecret(
  request: Request,
  makeError: (message: string, status: number) => Response,
): Response | null {
  return checkSecret(request, rechargeCallbackSecret(), makeError);
}
