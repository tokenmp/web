/**
 * 余额账本。
 *
 * 账户上有三个量，语义要与 openapi 对齐：
 *
 *   已用信用 = credit_limit - credit_available
 *   可用额度 = balance + credit_available
 *
 * `credit_available` 不存库，每次由 credit_limit 与 credit_used 算出来，
 * 免得三个数各写各的、对不上账。
 *
 * 记账规则两条，来自 openapi 对调账接口的说明：
 *
 *   入账（正数）先冲抵已用的信用额度，剩下的才进余额。
 *   扣款（负数）先扣余额，不够再占信用额度。
 *
 * 调账、订阅、用量扣费都走这里，一处改口径三处一起变。
 */

import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { db } from "./db";
import { apiKeys, creditTransactions, users } from "./schema";

/** DECIMAL(14,8) 的小数位。金额一律先乘 1e8 取整再算，避免浮点噪声。 */
const SCALE = 8;
const FACTOR = 10 ** SCALE;

/** 归到 8 位小数。0.1 + 0.2 这类浮点误差在这一步抹平；末尾把 -0 归成 0 */
export function round8(value: number) {
  return Math.round(value * FACTOR) / FACTOR + 0;
}

/** 写成 DECIMAL(14,8) 能接受的字符串。七位以上的小数直接进位，不留噪声 */
export function decimal8(value: number) {
  return round8(value).toFixed(SCALE);
}

export function creditAvailable(creditLimit: number, creditUsed: number) {
  return round8(creditLimit - creditUsed);
}

/** 扣款时余额与可用信用都不够。订阅那里要把它翻成 402 insufficient_balance */
export class InsufficientBalanceError extends Error {
  readonly userId: number;
  readonly required: number;
  readonly available: number;

  constructor(userId: number, required: number, available: number) {
    super("余额不足");
    this.name = "InsufficientBalanceError";
    this.userId = userId;
    this.required = required;
    this.available = available;
  }
}

/** 记账来源。refund 是退给用户的钱，与入账的 recharge 分开，对账时能单独拉出来 */
export type LedgerSource =
  | "recharge"
  | "adjust"
  | "usage"
  | "channel_share"
  | "subscription"
  | "refund";

export type LedgerMove = {
  userId: number;
  /** 正数入账，负数扣款 */
  amount: number;
  source: LedgerSource;
  refId?: string | null;
  reason?: string | null;
  /** 操作人，调账时是管理员的登录名 */
  operator?: string | null;
  model?: string | null;
  totalTokens?: number | null;
  /** 扣的是订阅额度还是余额，用量类流水才有 */
  ledger?: "quota" | "balance" | null;
  detail?: unknown;
  /** 扣款时余额不够也让过，余额记成负数。管理员调账用得上，订阅与用量不能用 */
  allowOverdraft?: boolean;
};

export type LedgerResult = {
  userId: number;
  delta: number;
  balancePart: number;
  creditPart: number;
  balance: number;
  creditUsed: number;
  creditLimit: number;
  creditAvailable: number;
  transactionId: number;
  createdAt: Date;
};

export class LedgerError extends Error {
  readonly code: "user_not_found" | "invalid_amount";
  constructor(code: LedgerError["code"], message: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

/**
 * 记账。整个动作在一个事务里，先 `SELECT ... FOR UPDATE` 锁住用户行 ——
 * 两个人同时给一个用户调账，不锁会丢更新。
 *
 * 调用方已经有事务（比如订阅要「扣款 + 写订阅 + 改 plan_id」原子）时用 applyCreditTx，
 * 不要嵌套开事务，mysql 不支持真的嵌套。
 */
export async function applyCredit(move: LedgerMove): Promise<LedgerResult> {
  const amount = round8(move.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new LedgerError("invalid_amount", "金额必须是非零数字");
  }
  return db.transaction(tx => applyCreditTx(tx, move, amount));
}

/** 事务类型。从 db.transaction 的回调参数里取，省得手写一堆泛型参数 */
export type LedgerTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** applyCredit 的事务内核。传入的 amount 必须已经校验过非零 */
export async function applyCreditTx(tx: LedgerTx, move: LedgerMove, precheckedAmount?: number) {
  const amount = precheckedAmount ?? round8(move.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new LedgerError("invalid_amount", "金额必须是非零数字");
  }

  const [row] = await tx
    .select({
      id: users.id,
      balance: users.balance,
      creditLimit: users.creditLimit,
      creditUsed: users.creditUsed,
    })
    .from(users)
    .where(eq(users.id, move.userId))
    .limit(1)
    .for("update");

  if (!row) throw new LedgerError("user_not_found", "用户不存在");

  const creditLimit = Number(row.creditLimit);
  let balance = Number(row.balance);
  let creditUsed = Number(row.creditUsed);

  let balancePart: number;
  let creditPart: number;

  if (amount > 0) {
    // 入账：先把欠的信用还上，剩下的进余额
    const repay = Math.min(amount, creditUsed);
    creditUsed = round8(creditUsed - repay);
    balancePart = round8(amount - repay);
    balance = round8(balance + balancePart);
    creditPart = round8(repay);
  } else {
    // 扣款：先扣余额，不够再占信用
    const need = round8(-amount);
    const available = round8(balance + creditAvailable(creditLimit, creditUsed));
    if (!move.allowOverdraft && need > available) {
      throw new InsufficientBalanceError(move.userId, need, available);
    }
    const fromBalance = Math.min(need, balance);
    const rest = round8(need - fromBalance);
    balance = round8(balance - fromBalance);
    creditUsed = round8(creditUsed + rest);
    balancePart = round8(-fromBalance);
    creditPart = round8(-rest);
  }

  const now = new Date();
  const [inserted] = await tx.insert(creditTransactions).values({
    userId: move.userId,
    delta: decimal8(amount),
    balanceAfter: decimal8(balance),
    creditUsedAfter: decimal8(creditUsed),
    source: move.source,
    refId: move.refId ?? null,
    reason: move.reason ?? null,
    operator: move.operator ?? null,
    model: move.model ?? null,
    totalTokens: move.totalTokens ?? null,
    balancePart: decimal8(balancePart),
    creditPart: decimal8(creditPart),
    ledger: move.ledger ?? null,
    detail: move.detail ?? null,
    createdAt: now,
  });

  await tx
    .update(users)
    .set({ balance: decimal8(balance), creditUsed: decimal8(creditUsed), updatedAt: now })
    .where(eq(users.id, move.userId));

  return {
    userId: move.userId,
    delta: amount,
    balancePart,
    creditPart,
    balance,
    creditUsed,
    creditLimit,
    creditAvailable: creditAvailable(creditLimit, creditUsed),
    transactionId: Number(inserted.insertId),
    createdAt: now,
  };
}

/* ------------------------------------------------------------ API 密钥 */

const KEY_PREFIX = "sk-";
/** 随机部分取 32 字节的 hex，48 位是前缀带 sk- 一共 9 位，与线上的 key_prefix 长度一致 */
const KEY_RANDOM_BYTES = 32;

/**
 * 生成一把密钥。明文只返回给调用方，库里存 sha256 —— 明文丢了就丢了，
 * 只能重新签发，任何查询都不回显。
 */
export function generateApiKey() {
  const bytes = new Uint8Array(KEY_RANDOM_BYTES);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  const plain = `${KEY_PREFIX}${random}`;
  return {
    plain,
    /** 前 9 位，形如 sk-abc123 */
    prefix: plain.slice(0, 9),
    /** 末 6 位，列表里用来辨认 */
    suffix: plain.slice(-6),
    hash: hashApiKey(plain),
  };
}

export function hashApiKey(plain: string) {
  return createHash("sha256").update(plain).digest("hex");
}

/** 密钥列表的统一形状：只给前后缀，不给明文 */
export function publicApiKey(row: typeof apiKeys.$inferSelect) {
  return {
    id: row.id,
    user_id: row.userId,
    name: row.name,
    key_prefix: row.keyPrefix,
    key_suffix: row.keySuffix,
    status: row.status,
    model_whitelist: row.modelWhitelist,
    rate_limit_per_min: row.rateLimitPerMin,
    expires_at: row.expiresAt,
    last_used_at: row.lastUsedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
