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
  /** 1 只看正常、0 只看已停用；不给就是不筛。取值口径与 admin-users 的 UserListParams 一致 */
  status?: 0 | 1;
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
      // status 是 0/1 两个值，query() 会把它变成字符串 "0"/"1" —— 后端比的就是字符串
      status: input.status,
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

/** 改授信。接口回 {ok:true}，没有 data 信封 */
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

/** 批量端点单次上限。常量定义在 validate.ts，前后端共用一份，超过由前端分批提交 */
export { BATCH_ADJUST_LIMIT as BATCH_LIMIT } from "./validate";
import { BATCH_ADJUST_LIMIT } from "./validate";

/** 批量端点的一条入参 */
export type BatchAdjustInput = {
  user_id: number;
  amount: number;
  reason: string;
  /** 默认 adjust，代充传 recharge */
  source?: AdjustSource;
};

/** 批量端点返回的逐条结果 */
export type BatchAdjustItemResult = {
  user_id: number;
  balance_after: number;
  ref: string;
};

/** POST /admin/balances/batch-adjust 的结果 */
export type BatchAdjustResult = {
  items: BatchAdjustItemResult[];
  count: number;
  total_amount: number;
};

/**
 * 批量调账 / 代充，一次请求一整批。服务端在一个事务里全成或全滚，
 * 所以这里没有「部分成功」的返回形状。
 */
export function batchAdjust(items: BatchAdjustInput[]) {
  return postData<BatchAdjustResult>("/api/admin/balances/batch-adjust", { items });
}

export type BatchRechargeResult = {
  /** 计划处理的账户数 */
  total: number;
  /** 实际入账的条数 */
  succeeded: number;
  /** 服务端汇总的入账金额 */
  totalAmount: number;
  /** 最后一条入账之后的余额，给操作者一个即时反馈 */
  lastBalanceAfter: number | null;
  /** 最后一条的流水号 */
  ref: string | null;
  /** 分成几次事务提交，1 表示一次全成 */
  batches: number;
};

/**
 * 分批提交中途失败时抛出，带上已经落库的批数。
 * 批与批之间不是原子的，弹窗要据此说清「前面几批已经入账」。
 */
export class BatchRechargeError extends Error {
  readonly applied: number;
  readonly batches: number;

  constructor(message: string, applied: number, batches: number) {
    super(message);
    this.name = "BatchRechargeError";
    this.applied = applied;
    this.batches = batches;
  }
}

/** 按上限切段，保留顺序 */
function chunkTargets<T>(targets: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < targets.length; i += size) out.push(targets.slice(i, i + size));
  return out;
}

/** 批量充值（source=recharge）。
 *
 * 每个不超过 200 的批一次请求、一个事务，整体要么全成要么全回滚；超过 200 时按顺序
 * 拆成多批，批与批之间不再原子 —— 某一批失败时前面的批已经落库，用
 * BatchRechargeError.applied 告诉调用方已经成功了几批。
 */
export async function batchRecharge(
  targets: { id: number; name: string }[],
  amount: number,
  reason: string,
): Promise<BatchRechargeResult> {
  const chunks = chunkTargets(targets, BATCH_ADJUST_LIMIT);
  let succeeded = 0;
  let totalAmount = 0;
  let lastBalanceAfter: number | null = null;
  let ref: string | null = null;
  let appliedBatches = 0;

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    try {
      const res = await batchAdjust(
        chunk.map(target => ({
          user_id: target.id,
          amount,
          reason,
          source: "recharge" as const,
        })),
      );
      succeeded += res.count;
      // 与账本层同样的 8 位小数归整，避免浮点累加出噪声
      totalAmount = Math.round((totalAmount + res.total_amount) * 1e8) / 1e8;
      const last = res.items[res.items.length - 1];
      if (last) {
        lastBalanceAfter = last.balance_after;
        ref = last.ref;
      }
      appliedBatches += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "请求失败";
      const prefix = chunks.length > 1 ? `第 ${i + 1}/${chunks.length} 批失败：` : "";
      throw new BatchRechargeError(prefix + message, appliedBatches, chunks.length);
    }
  }

  return {
    total: targets.length,
    succeeded,
    totalAmount,
    lastBalanceAfter,
    ref,
    batches: chunks.length,
  };
}

/**
 * 取当前筛选下的全部账户。GET /admin/users 一页最多 100，这里翻页取完。
 * 只回 id 与 name，够批量充值用，也避免把整页的预算与订阅快照都搬回来。
 *
 * 筛选是在服务端做的，界面手上只有当前这一页，所以参数必须与列表页保持同一套 ——
 * 少传一个筛选条件，批量充值就会打到界面上没显示出来的账户上。
 * 先拿 total 再按 total 翻页；两次请求之间数据变了也不会死循环。
 */
export async function fetchAllBalanceAccounts(
  input: { keyword?: string; status?: 0 | 1 } = {},
) {
  const size = 100;
  const out: { id: number; name: string }[] = [];
  let page = 1;
  for (;;) {
    const res = await fetchBalanceAccounts({
      page,
      size,
      keyword: input.keyword,
      status: input.status,
    });
    for (const account of res.items) out.push({ id: account.id, name: account.name });
    if (res.total <= 0 || out.length >= res.total || res.items.length === 0) break;
    page += 1;
  }
  return out;
}
