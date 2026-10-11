import type { APIEvent } from "@solidjs/start/server";

import { guardUser } from "~/lib/api-auth";
import { errorJson, json, num, parsePaging } from "~/lib/http";
import { createRechargeOrder, DEFAULT_CHANNEL, listRechargeOrders } from "~/lib/recharge";
import { checkMoney, checkText } from "~/lib/validate";

/**
 * 用户自助充值。openapi 里没有这两个端点（充值此前只有管理员代充一条路），
 * 属于本机扩展，形状沿用其他列表与单对象端点的约定。
 *
 * POST 只负责下单：写一张 pending 的单子，真正入账等渠道回调。
 * 没有真实渠道时，前端（或本机联调）拿返回的 order_no 直接叫一次
 * /api/internal/recharge-callback 即可把流程走完。
 */

/** 渠道名只允许常见的短标识，避免把带尖括号或空格的东西写进列里 */
const CHANNEL_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;

export async function POST({ request }: APIEvent) {
  const guard = await guardUser(request);
  if ("error" in guard) return guard.error;

  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  const amount = body?.amount;
  // checkMoney 已经挡住非数字与超出 DECIMAL(14,8) 范围的值，这里再要求正数：
  // 充值金额可以是小数，但不能是 0 或负数。
  const amountProblem = checkMoney(amount, "amount");
  if (amountProblem) return errorJson(amountProblem, 400);
  if (typeof amount === "number" && amount <= 0) return errorJson("amount 必须大于 0", 400);

  const rawChannel = body?.channel === undefined || body?.channel === null ? DEFAULT_CHANNEL : body.channel;
  if (typeof rawChannel !== "string" || !CHANNEL_PATTERN.test(rawChannel.trim())) {
    return errorJson("channel 只能是字母、数字、下划线或短横线组成的短标识", 400);
  }
  const channelProblem = checkText(rawChannel, "channel", 24);
  if (channelProblem) return errorJson(channelProblem, 400);

  const order = await createRechargeOrder({
    userId: guard.user.id,
    amount: amount as number,
    channel: rawChannel.trim(),
  });

  return json(
    {
      data: {
        order_no: order.orderNo,
        amount: num(order.amount),
        channel: order.channel,
        status: order.status,
      },
    },
    201,
  );
}

/** 我的充值单，分页。形状是 ListEnvelope（items / total 在顶层） */
export async function GET({ request }: APIEvent) {
  const guard = await guardUser(request);
  if ("error" in guard) return guard.error;

  const url = new URL(request.url);
  const { size, offset } = parsePaging(url);

  const { items, total } = await listRechargeOrders({ userId: guard.user.id, size, offset });

  return json({ ok: true, items, total });
}
