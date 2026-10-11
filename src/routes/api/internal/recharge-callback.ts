import type { APIEvent } from "@solidjs/start/server";

import { errorJson, json, num } from "~/lib/http";
import {
  CALLBACK_STATUSES,
  checkCallbackSecret,
  processRechargeCallback,
  serializeOrder,
  type CallbackStatus,
} from "~/lib/recharge";
import { checkText } from "~/lib/validate";

/**
 * 渠道支付回调。这个端点不由浏览器带着会话调，走 x-callback-secret 共享密钥。
 *
 * 幂等：同一张单重复回调只在第一次入账。判据是单子当前状态是不是 pending，
 * 落库与入账在 processRechargeCallback 的同一个事务里完成。
 *
 * 换真渠道时只改这个入口的验签方式（比如从 header 换成渠道自己的签名头），
 * 下面的处理逻辑不用动。
 */
export async function POST({ request }: APIEvent) {
  const denied = checkCallbackSecret(request, errorJson);
  if (denied) return denied;

  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  const orderProblem = checkText(body?.order_no, "order_no", 64);
  if (orderProblem) return errorJson(orderProblem, 400);

  const status = body?.status;
  if (typeof status !== "string" || !(CALLBACK_STATUSES as readonly string[]).includes(status)) {
    return errorJson(`status 只能是 ${CALLBACK_STATUSES.join(" / ")}`, 400);
  }

  const rawExternalNo = body?.external_no;
  let externalNo: string | null = null;
  if (rawExternalNo !== undefined && rawExternalNo !== null && rawExternalNo !== "") {
    const problem = checkText(rawExternalNo, "external_no", 128);
    if (problem) return errorJson(problem, 400);
    externalNo = (rawExternalNo as string).trim();
  }

  // amount 可以带，但只用来对账；真正入账的金额一律以本机单子上记的为准，
  // 免得渠道回一个被改过的数就把钱算错。带了但不是数字照样挡掉。
  if (body?.amount !== undefined && body?.amount !== null) {
    if (typeof body.amount !== "number" || !Number.isFinite(body.amount)) {
      return errorJson("amount 必须是数字", 400);
    }
  }

  const result = await processRechargeCallback({
    orderNo: (body?.order_no as string).trim(),
    externalNo,
    status: status as CallbackStatus,
  });

  switch (result.kind) {
    case "not_found":
      return errorJson("充值单不存在", 404);
    case "user_missing":
      // 事务里抛错会回滚，单子仍然是 pending，补回用户后可以再回调
      return errorJson("充值单对应的用户不存在", 404);
    case "already":
      return json({ ok: true, already: true, order_no: result.order.orderNo, status: result.order.status });
    case "marked":
      return json({
        ok: true,
        already: false,
        order_no: result.order.orderNo,
        status: result.order.status,
      });
    case "credited":
      return json({
        ok: true,
        already: false,
        order_no: result.order.orderNo,
        status: result.order.status,
        amount: num(result.order.amount),
        credit_transaction_id: result.transactionId,
        order: serializeOrder(result.order),
      });
  }
}
