/**
 * 充值单页的客户端数据层。
 *
 * 只做两件事：把筛选条件拼进查询串，把服务端返回的充值单交给页面。
 * 金额、状态、时间都以服务端为准，前端不做二次加工 —— 订单状态是渠道回调
 * 推进的，本地重算没有意义。
 *
 * 字段名与控制台的通用口径一致（snake_case），会话 cookie 由浏览器自己带上。
 */

import { getList, query } from "./api-client";

export type RechargeStatus = "pending" | "paid" | "failed" | "cancelled" | "refunded";

/** 充值单状态的中文名。pending 与 failed 是运营要盯的两类 */
export const RECHARGE_STATUS_LABEL: Record<RechargeStatus, string> = {
  pending: "待支付",
  paid: "已到账",
  failed: "失败",
  cancelled: "已取消",
  refunded: "已退款",
};

/** GET /api/admin/recharge 的一项 */
export type AdminRechargeOrder = {
  id: number;
  order_no: string;
  user_id: number;
  user_name: string;
  user_email: string | null;
  amount: number;
  currency: string;
  channel: string;
  status: string;
  /** 渠道侧的单号，回调带上来的；还没回调时为 null */
  external_no: string | null;
  paid_at: string | null;
  /** 账本流水 id，为空表示这单还没入账 */
  credit_transaction_id: number | null;
  created_at: string;
  updated_at: string;
};

export type RechargeQuery = {
  page: number;
  size: number;
  /** 传字符串，接口对非数字静默忽略 */
  user_id?: string;
  status?: RechargeStatus;
  channel?: string;
  /** ISO 时间串，非法值后端静默忽略 */
  start?: string;
  end?: string;
};

/** 充值单列表，按 created_at 倒序分页，total 在顶层 */
export function fetchRechargeOrders(input: RechargeQuery) {
  return getList<AdminRechargeOrder>(
    `/api/admin/recharge${query({
      page: input.page,
      size: input.size,
      user_id: input.user_id,
      status: input.status,
      channel: input.channel,
      start: input.start,
      end: input.end,
    })}`,
  );
}
