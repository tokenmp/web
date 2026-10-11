/**
 * 余额账本页的客户端数据层。
 *
 * 页面只负责收集输入、展示结果，金额一律以服务端返回的 `balance_after` 为准 ——
 * 前端不自己加减余额。入账先冲抵已用授信、扣款先扣余额再用授信，这套口径在账本层
 * （src/lib/ledger.ts）实现，这里只是把请求发出去。
 *
 * 字段名与 openapi.yaml 一致（snake_case），会话 cookie 由浏览器自己带上。
 */

import { getList, postData, putData, putOk, query } from "./api-client";

export type AdjustSource = "adjust" | "recharge";
export type AdjustDirection = "credit" | "debit";
export type BudgetPeriod = "day" | "week" | "month";

export type ListResult<T> = { items: T[]; total: number };

/** 预算封顶。enabled=0 或 amount=0 都表示还没设，两个都要判 */
export type UserBudget = {
  user_id: number;
  enabled: number;
  amount: number;
  period: BudgetPeriod;
  period_start: string | null;
  period_end: string | null;
  used: number;
  version: number;
  updated_at: string | null;
};

/** 用户当前的订阅快照，没有订阅时为 null */
export type UserSubscription = {
  plan_id: number;
  quota_kind: string | null;
  quota_limit: number;
  quota_used: number;
  period_start: string | null;
  period_end: string | null;
};

/** GET /admin/users 的一项。只取这一页要用的字段，用户管理页自己另有一份 */
export type BalanceAccount = {
  id: number;
  name: string;
  email: string | null;
  role: string;
  status: number;
  credit_limit: number;
  /** 可用余额，恒存在。负数表示已经透支到授信里 */
  balance: number;
  budget: UserBudget;
  subscription: UserSubscription | null;
};

export type AdjustLogItem = {
  id: number;
  user_id: number;
  user_name: string;
  /** 正数入账，负数扣款 */
  delta: number;
  balance_after: number;
  /** 形如 adj-1759999999 或 rc-1759999999 */
  ref_id: string;
  reason: string;
  operator: string;
  created_at: string;
};

/** POST /admin/balances/adjust 的结果 */
export type AdjustResult = {
  user_id: number;
  balance_after: number;
  ref: string;
};

export type AccountQuery = {
  page: number;
  size: number;
  keyword?: string;
  sort?: string;
  order?: "asc" | "desc";
};

export type AdjustLogQuery = {
  page: number;
  size: number;
  /** 传字符串，接口对非数字静默忽略 */
  user_id?: string;
  operator?: string;
  direction?: AdjustDirection;
  ref?: string;
  /** ISO 时间串，非法值后端静默忽略 */
  start?: string;
  end?: string;
};

/* ------------------------------------------------------------------ 读 */

/** 用户与余额列表。每项带 balance、budget、subscription 快照 */
export function fetchBalanceAccounts(input: AccountQuery) {
  return getList<BalanceAccount>(
    `/api/admin/users${query({
      page: input.page,
      size: input.size,
      keyword: input.keyword,
      sort: input.sort,
      order: input.order,
    })}`,
  );
}

/**
 * 调账记录。只含 adjust 与 recharge 两类，按 created_at 倒序。
 * 用量扣费、订阅扣款、分享返额都不在这里，用户看全部流水走 /user/credits。
 */
export function fetchAdjustLogs(input: AdjustLogQuery) {
  return getList<AdjustLogItem>(
    `/api/admin/adjust-logs${query({
      page: input.page,
      size: input.size,
      user_id: input.user_id,
      operator: input.operator,
      direction: input.direction,
      ref: input.ref,
      start: input.start,
      end: input.end,
    })}`,
  );
}

/* ------------------------------------------------------------------ 写 */

export type AdjustmentInput = {
  userId: number;
  /** 正数入账、负数扣款，不能为 0 */
  amount: number;
  reason: string;
  source: AdjustSource;
};

/**
 * 手工调账与代充共用同一个端点，区别只在 source。
 * 允许透支：扣款不因余额不足被拦下，扣成负数由授信承接。
 */
export function applyAdjustment(input: AdjustmentInput) {
  return postData<AdjustResult>("/api/admin/balances/adjust", {
    user_id: input.userId,
    amount: input.amount,
    reason: input.reason,
    source: input.source,
  });
}

/** 改授信额度。接口回 {ok:true}，没有 data 信封 */
export function updateCreditLimit(userId: number, creditLimit: number) {
  return putOk(`/api/admin/users/${userId}`, { credit_limit: creditLimit });
}

/** 设预算。enabled=false 或 amount=0 都表示清除，接口回设置后的预算 */
export function setUserBudget(
  userId: number,
  input: { enabled: boolean; amount: number; period: BudgetPeriod },
) {
  return putData<UserBudget>(`/api/admin/users/${userId}/budget`, input);
}

/* --------------------------------------------------------------- 批量 */

export type BatchFailure = { userId: number; name: string; message: string };

export type BatchRechargeResult = {
  total: number;
  succeeded: number;
  failed: BatchFailure[];
  /** 最后一笔成功之后的余额，给操作者一个即时反馈 */
  lastBalanceAfter: number | null;
};

/**
 * 批量充值：对给定账户逐笔走调账端点（source=recharge）。
 *
 * 串行而不是并发：同一个用户的余额行在账本层会加锁，并发提交只会互相等待；
 * 串行还能让失败原因与提交顺序一一对上，汇总时好读。单笔失败不影响后续，
 * 全部结果一起回给弹窗展示。
 */
export async function batchRecharge(
  targets: { id: number; name: string }[],
  amount: number,
  reason: string,
): Promise<BatchRechargeResult> {
  const failed: BatchFailure[] = [];
  let succeeded = 0;
  let lastBalanceAfter: number | null = null;

  for (const target of targets) {
    try {
      const result = await applyAdjustment({
        userId: target.id,
        amount,
        reason,
        source: "recharge",
      });
      succeeded += 1;
      lastBalanceAfter = result.balance_after;
    } catch (err) {
      failed.push({
        userId: target.id,
        name: target.name,
        message: err instanceof Error ? err.message : "请求失败",
      });
    }
  }

  return { total: targets.length, succeeded, failed, lastBalanceAfter };
}
