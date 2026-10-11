import type { APIEvent } from "@solidjs/start/server";

import { guardAdmin } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json } from "~/lib/http";
import { applyCreditTx, LedgerError, round8, type LedgerSource } from "~/lib/ledger";
import { BATCH_ADJUST_LIMIT, checkMoney, checkText } from "~/lib/validate";

/**
 * 本机扩展的 source 取值，与单笔调账端点保持一致：代充是 recharge，改授信是 adjust。
 * 不传按 adjust 处理。
 */
const SOURCES = ["adjust", "recharge"] as const;
type AdjustSource = (typeof SOURCES)[number];

/**
 * 一次请求最多处理多少个账户。
 *
 * 整个批量在同一个事务里，每一条都会 `SELECT ... FOR UPDATE` 锁住用户行。
 * 上限不设的话，一个请求就能锁住半张 users 表，别的写入全部排队。
 * 200 既是保护，也是前端分批提交的粒度。
 */
const MAX_REASON = 256;

/**
 * 事务内发现的问题用这个往外抛，带上具体是第几条与对应的 HTTP 状态码。
 * 抛在事务里会让 drizzle 回滚，外层再把它翻成响应，前面已经写下的条目不会落库。
 */
class BatchAbort extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BatchAbort";
    this.status = status;
  }
}

type NormalizedItem = {
  /** 从 1 开始的位置，错误文案里直接引用 */
  index: number;
  userId: number;
  amount: number;
  reason: string;
  source: AdjustSource;
};

/**
 * POST /api/admin/balances/batch-adjust
 *
 * 批量代充 / 调账。与单笔 `/api/admin/balances/adjust` 的语义一致（金额以服务端
 * balance_after 为准，正数先冲抵已用授信），区别只有两点：
 *
 *   1. 所有条目在同一个事务里，全部成功或全部回滚；
 *   2. 最多 200 条，超过回 400。
 *
 * 记账复用 `applyCreditTx` —— 调用方已经有事务时必须用它，`applyCredit` 会自己再开
 * 一个事务，而 mysql 不支持真嵌套。
 */
export async function POST({ request }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  const rawItems = body?.items;
  if (!Array.isArray(rawItems)) return errorJson("items 必须是数组", 400);
  if (rawItems.length === 0) return errorJson("items 不能为空", 400);
  if (rawItems.length > BATCH_ADJUST_LIMIT) {
    return errorJson(`一次最多 ${BATCH_ADJUST_LIMIT} 条，当前 ${rawItems.length} 条`, 400);
  }

  // 先整批校验完再动数据库：任何一条不合法都直接 400，不必进事务再回滚。
  const items: NormalizedItem[] = [];
  for (let i = 0; i < rawItems.length; i += 1) {
    const at = i + 1;
    const raw = rawItems[i];
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return errorJson(`第 ${at} 条不是对象`, 400);
    }
    const item = raw as Record<string, unknown>;

    const userId = item.user_id;
    if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
      return errorJson(`第 ${at} 条：user_id 必须是正整数`, 400);
    }

    // 数字字段只认 number："5" 这种字符串不做隐式转换，与单笔端点同一口径。
    const amount = item.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
      return errorJson(`第 ${at} 条：amount 必须是非零数字`, 400);
    }
    const amountProblem = checkMoney(amount, "amount");
    if (amountProblem) return errorJson(`第 ${at} 条：${amountProblem}`, 400);

    const reasonProblem = checkText(item.reason, "reason", MAX_REASON);
    if (reasonProblem) return errorJson(`第 ${at} 条：${reasonProblem}`, 400);

    const rawSource = item.source === undefined || item.source === null ? "adjust" : item.source;
    if (typeof rawSource !== "string" || !(SOURCES as readonly string[]).includes(rawSource)) {
      return errorJson(`第 ${at} 条：source 只能是 adjust 或 recharge`, 400);
    }

    items.push({
      index: at,
      userId,
      amount,
      reason: (item.reason as string).trim(),
      source: rawSource as AdjustSource,
    });
  }

  // 同一次批量共用一个 unix 秒时间戳，ref 形如 rc-<秒> / adj-<秒>，与单笔调账一致。
  // ref_id 上没有唯一约束，同一秒的多次批量重名是可接受的。
  const stamp = Math.floor(Date.now() / 1000);

  // 按 user_id 排序后再记账。记账会对用户行 SELECT ... FOR UPDATE，
  // 两个并发批量若按相反的顺序锁同一批用户，MySQL 会报 1213 死锁（漏成 500）。
  // 统一升序加锁就把这一环消除了。
  const ordered = [...items].sort((a, b) => a.userId - b.userId);

  try {
    const rows = await db.transaction(async tx => {
      const out: { user_id: number; balance_after: number; ref: string }[] = [];
      for (const item of ordered) {
        const ref = `${item.source === "recharge" ? "rc" : "adj"}-${stamp}`;
        try {
          const result = await applyCreditTx(tx, {
            userId: item.userId,
            amount: item.amount,
            source: item.source as LedgerSource,
            reason: item.reason,
            operator: admin.name,
            refId: ref,
            allowOverdraft: true,
          });
          out.push({ user_id: result.userId, balance_after: result.balance, ref });
        } catch (err) {
          // 在事务内把「第几条、用户几」补进错误里，否则外层只知道有个用户不存在。
          if (err instanceof LedgerError && err.code === "user_not_found") {
            throw new BatchAbort(404, `第 ${item.index} 条：用户 ${item.userId} 不存在`);
          }
          if (err instanceof LedgerError) {
            throw new BatchAbort(400, `第 ${item.index} 条：金额不合法`);
          }
          throw err;
        }
      }
      return out;
    });

    const totalAmount = round8(items.reduce((sum, item) => sum + item.amount, 0));
    return json({
      data: { items: rows, count: rows.length, total_amount: totalAmount },
    });
  } catch (err) {
    if (err instanceof BatchAbort) return errorJson(err.message, err.status);
    throw err;
  }
}
