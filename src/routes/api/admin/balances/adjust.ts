import type { APIEvent } from "@solidjs/start/server";

import { requireUser } from "~/lib/api-auth";
import { errorJson, json } from "~/lib/http";
import { applyCredit, InsufficientBalanceError, LedgerError } from "~/lib/ledger";

/**
 * 本机扩展的 source 取值。openapi 的 /admin/balances/adjust 只描述了管理员调账，
 * 没有这个字段；本机把「代充」也归到同一个端点，用 source 区分：
 * 代充是 recharge，改授信是 adjust。不传按 adjust 处理，与线上只有一种语义时一致。
 */
const SOURCES = ["adjust", "recharge"] as const;
type AdjustSource = (typeof SOURCES)[number];

/**
 * POST /api/admin/balances/adjust
 *
 * 管理员手工调账：正数入账、负数扣款，正数会先冲抵已用的信用额度（applyCredit 的口径）。
 * 允许透支 —— 管理员想扣多少就该扣多少，余额扣成负数由 credit_used 承接，
 * 不能让「余额不够」拦住管理动作。
 */
export async function POST({ request }: APIEvent) {
  // 分开判未登录与权限不足：openapi 把 401 与 403 分成两个状态码，
  // 只调 requireAdmin 会把未登录也报成 403，前端无法据此引导登录。
  const user = await requireUser(request);
  if (!user) return errorJson("请先登录", 401);
  if (user.role !== "admin") return errorJson("需要管理员权限", 403);

  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  const rawUserId = body?.user_id;
  if (typeof rawUserId !== "number" || !Number.isInteger(rawUserId) || rawUserId <= 0) {
    return errorJson("user_id 必须是正整数", 400);
  }

  // NaN、Infinity、0 都挡在这里。字符串数字也拒绝 —— openapi 声明 amount 是 number，
  // 这里不做隐式转换，免得 "abc" 经 Number() 变成 NaN 后才被当成参数错。
  const amount = body?.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
    return errorJson("amount 必须是非零数字", 400);
  }

  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) return errorJson("reason 不能为空", 400);
  if (reason.length > 256) return errorJson("reason 不能超过 256 字", 400);

  const rawSource = body?.source === undefined || body?.source === null ? "adjust" : body.source;
  if (typeof rawSource !== "string" || !(SOURCES as readonly string[]).includes(rawSource)) {
    return errorJson("source 只能是 adjust 或 recharge", 400);
  }
  const source = rawSource as AdjustSource;

  // ref_id 用 unix 秒给同一次操作一个可读标识；两类来源用不同前缀区分。
  // 同一秒内的两次调账 ref 会重名，但 ref_id 上没有唯一约束，列表靠它过滤即可。
  const stamp = Math.floor(Date.now() / 1000);
  const refId = `${source === "recharge" ? "rc" : "adj"}-${stamp}`;

  try {
    const result = await applyCredit({
      userId: rawUserId,
      amount,
      source,
      reason,
      operator: user.name,
      refId,
      allowOverdraft: true,
    });

    return json({
      data: {
        user_id: result.userId,
        balance_after: result.balance,
        ref: refId,
      },
    });
  } catch (err) {
    if (err instanceof LedgerError) {
      // invalid_amount 理论上进不来（上面已经校验过），留着是为了不让账本层的错误漏成 500
      return err.code === "user_not_found" ? errorJson("用户不存在", 404) : errorJson("金额不合法", 400);
    }
    if (err instanceof InsufficientBalanceError) {
      // allowOverdraft=true 时不会走到这里；万一将来关掉透支，语义也对得上。
      return errorJson("余额不足", 402);
    }
    throw err;
  }
}
