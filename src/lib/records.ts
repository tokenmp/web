/**
 * 调用记录、计费流水与用量的服务端逻辑。
 *
 * 数据的产生方是转发内核（另一个仓库），本机负责存、查、汇总。摄入走
 * `/api/internal/records`，用 request_id 做幂等键：网关重发同一批日志不会记两遍。
 *
 * 计费行还要在场扣费：新插进去的 billing 行按 revenue_amount 记账，走哪个口袋
 *（订阅额度还是余额）由本机判，与插行在同一个事务里，见下面的 chargeBilling。
 *
 * 查询与聚合分成三层：
 *   - 列表：筛选 + 分页，字段形状照 openapi 的 RequestRecord / BillingRecord。
 *   - 用量序列：按天的 requests / tokens / revenue，外加按模型的拆分。
 *   - 概览：最近 24 小时的请求数、成功率、成本、收入，以及余额不足的用户数。
 *
 * 金额一律用 SQL 汇总（SUM 返回 DECIMAL 字符串），在 JS 侧用 Number() 收口，
 * 不把整表拉回来自己加，免得数据一多就出问题。
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  like,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { isDuplicateEntry } from "./db-error";
import { db } from "./db";
import { applyCreditTx, decimal8, LedgerError, round8, type LedgerTx } from "./ledger";
import {
  billingRecords,
  requestRecords,
  subscriptions,
  users,
  type BillingRecordRow,
  type RequestRecordRow,
} from "./schema";

/* ------------------------------------------------------------------ 通用工具 */

/** 模糊匹配的转义，避免用户输入的 % 与 _ 被当成通配符 */
function likePattern(value: string) {
  return `%${value.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 字符串字段：允许数字/布尔被转成文本，trim，超长截断（列是 VARCHAR，超了会 500） */
function str(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return String(value).slice(0, max);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** TEXT 列：不截断，但非字符串/数字一律不接受 */
function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return typeof value === "string" ? value : null;
}

function bool01(value: unknown, fallback: number | null = 0): number | null {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value ? 1 : 0;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["1", "true", "yes", "y"].includes(text)) return 1;
    if (["0", "false", "no", "n", ""].includes(text)) return 0;
  }
  return fallback;
}

/** INT 列：非整数或超出 int32 就丢掉，不抛错 */
function intOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const v = Math.trunc(n);
  if (v < -2_147_483_648 || v > 2_147_483_647) return null;
  return v;
}

/** BIGINT 计数列：只做数值化，不设上限 */
function bigOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** DECIMAL 列：按列的 scale 格式化，超范围的值原样交给校验挡（返回 null 表示丢弃） */
function decOrNull(value: unknown, scale: number): string | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** scale;
  return (Math.round(n * factor) / factor).toFixed(scale);
}

/** JSON 列：数组或对象原样收下，其余当空 */
function jsonOrNull(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return value;
  return null;
}

/**
 * 时间字段。接受 ISO 字符串、Date、毫秒时间戳；秒级时间戳（小于 1e11）自动按秒理解。
 * 网关那边可能两种都发，这里兼容一下，解析不出来就当没有。
 */
function dateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const ms = Math.abs(value) < 1e11 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** 路由侧解析 start / end 查询参数：非法值静默忽略（openapi 明写的行为） */
export function parseDateParam(value: string | null): Date | null {
  if (!value) return null;
  return dateOrNull(value);
}

/* ------------------------------------------------------------ 摄入的字段归一 */

export type RequestRecordInsert = ReturnType<typeof normalizeRequestRecord>;

/** 把网关回写的 RequestRecord 归一到插入用的形状；没有 request_id 的整条丢掉 */
export function normalizeRequestRecord(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const requestId = str(r.request_id ?? r.requestId, 64);
  if (!requestId) return null;

  return {
    requestId,
    userId: bigOrNull(r.user_id ?? r.userId),
    apiKeyId: bigOrNull(r.api_key_id ?? r.apiKeyId),
    model: str(r.model, 128),
    servedModel: str(r.served_model ?? r.servedModel, 128),
    entry: str(r.entry, 32),
    stream: bool01(r.stream) ?? 0,
    channel: str(r.channel, 128),
    channelType: str(r.channel_type ?? r.channelType, 32),
    baseUrl: str(r.base_url ?? r.baseUrl, 512),
    status: str(r.status, 16) ?? "in_progress",
    httpStatus: intOrNull(r.http_status ?? r.httpStatus),
    errorMessage: text(r.error_message ?? r.errorMessage),
    errorCode: str(r.error_code ?? r.errorCode, 64),
    renderStatus: intOrNull(r.render_status ?? r.renderStatus),
    upstreamCode: str(r.upstream_code ?? r.upstreamCode, 64),
    upstreamMessage: text(r.upstream_message ?? r.upstreamMessage),
    panelMessage: text(r.panel_message ?? r.panelMessage),
    attempts: intOrNull(r.attempts),
    retried: bool01(r.retried, null),
    userAgent: str(r.user_agent ?? r.userAgent, 512),
    reasoningEffort: str(r.reasoning_effort ?? r.reasoningEffort, 32),
    latencyMs: intOrNull(r.latency_ms ?? r.latencyMs),
    ttfbMs: intOrNull(r.ttfb_ms ?? r.ttfbMs),
    tps: decOrNull(r.tps, 4),
    promptTokens: bigOrNull(r.prompt_tokens ?? r.promptTokens),
    completionTokens: bigOrNull(r.completion_tokens ?? r.completionTokens),
    cacheReadTokens: bigOrNull(r.cache_read_tokens ?? r.cacheReadTokens),
    cacheWriteTokens: bigOrNull(r.cache_write_tokens ?? r.cacheWriteTokens),
    totalTokens: bigOrNull(r.total_tokens ?? r.totalTokens),
    startedAt: dateOrNull(r.started_at ?? r.startedAt),
    finishedAt: dateOrNull(r.finished_at ?? r.finishedAt),
    createdAt: dateOrNull(r.created_at ?? r.createdAt) ?? new Date(),
  };
}

export type BillingRecordInsert = NonNullable<ReturnType<typeof normalizeBillingRecord>>;

/** 把网关回写的 BillingRecord 归一到插入用的形状 */
export function normalizeBillingRecord(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const requestId = str(r.request_id ?? r.requestId, 64);
  if (!requestId) return null;

  return {
    requestId,
    userId: bigOrNull(r.user_id ?? r.userId),
    apiKeyId: bigOrNull(r.api_key_id ?? r.apiKeyId),
    planId: bigOrNull(r.plan_id ?? r.planId),
    channelId: bigOrNull(r.channel_id ?? r.channelId),
    channelName: str(r.channel_name ?? r.channelName, 128),
    ownerUserId: bigOrNull(r.owner_user_id ?? r.ownerUserId),
    entry: str(r.entry, 32),
    model: str(r.model, 128),
    stream: bool01(r.stream) ?? 0,
    usageSource: str(r.usage_source ?? r.usageSource, 32),
    chargeMode: str(r.charge_mode ?? r.chargeMode, 32),
    costMultiplier: decOrNull(r.cost_multiplier ?? r.costMultiplier, 8) ?? "1",
    costMultiplierRules: jsonOrNull(r.cost_multiplier_rules ?? r.costMultiplierRules),
    costAmount: decOrNull(r.cost_amount ?? r.costAmount, 8) ?? "0",
    revenueMultiplier: decOrNull(r.revenue_multiplier ?? r.revenueMultiplier, 8) ?? "1",
    revenueMultiplierRules: jsonOrNull(r.revenue_multiplier_rules ?? r.revenueMultiplierRules),
    revenueAmount: decOrNull(r.revenue_amount ?? r.revenueAmount, 8) ?? "0",
    ownerCreditAmount: decOrNull(r.owner_credit_amount ?? r.ownerCreditAmount, 8) ?? "0",
    currency: str(r.currency, 3) ?? "CNY",
    billingMode: str(r.billing_mode ?? r.billingMode, 32),
    ledger: str(r.ledger, 16),
    latencyMs: intOrNull(r.latency_ms ?? r.latencyMs),
    httpStatus: intOrNull(r.http_status ?? r.httpStatus),
    attempts: intOrNull(r.attempts),
    retried: bool01(r.retried, null),
    status: str(r.status, 16) ?? "settled",
    promptTokens: bigOrNull(r.prompt_tokens ?? r.promptTokens) ?? 0,
    completionTokens: bigOrNull(r.completion_tokens ?? r.completionTokens) ?? 0,
    cacheReadTokens: bigOrNull(r.cache_read_tokens ?? r.cacheReadTokens) ?? 0,
    cacheWriteTokens: bigOrNull(r.cache_write_tokens ?? r.cacheWriteTokens) ?? 0,
    totalTokens: bigOrNull(r.total_tokens ?? r.totalTokens) ?? 0,
    createdAt: dateOrNull(r.created_at ?? r.createdAt) ?? new Date(),
  };
}

/* -------------------------------------------------------------------- 摄入 */

type RequestKeyedTable = typeof requestRecords | typeof billingRecords;
type InsertRow = { requestId: string } & Record<string, unknown>;

/**
 * 幂等插入：先批量查已有的 request_id，只插新的；撞车（并发）时逐行 INSERT IGNORE 兜底。
 * 返回真正插进去的那几行与被当成重复跳过的条数 —— 扣费要挂在确实新插进去的行上，
 * 只回两个计数不够用。事务由调用方开，插行与扣费共用同一个 tx。
 */
async function insertNew(
  tx: LedgerTx,
  table: RequestKeyedTable,
  rows: InsertRow[],
): Promise<{ inserted: InsertRow[]; skipped: number }> {
  if (rows.length === 0) return { inserted: [], skipped: 0 };

  const existing = new Set<string>();
  for (const chunk of chunkArray(
    rows.map(row => row.requestId),
    400,
  )) {
    const found = await tx
      .select({ requestId: table.requestId })
      .from(table)
      .where(inArray(table.requestId, chunk));
    for (const row of found) existing.add(row.requestId);
  }

  const fresh = rows.filter(row => !existing.has(row.requestId));
  const skipped = rows.length - fresh.length;

  const inserted: InsertRow[] = [];
  for (const chunk of chunkArray(fresh, 80)) {
    try {
      // 两张表的列不同，这里只借用公共的 request_id 做去重，具体行交给 drizzle
      await tx.insert(table).values(chunk as never);
      inserted.push(...chunk);
    } catch (err) {
      if (!isDuplicateEntry(err)) throw err;
      for (const row of chunk) {
        const result = (await tx
          .insert(table)
          .ignore()
          .values(row as never)) as unknown;
        const header = (Array.isArray(result) ? result[0] : result) as
          | { affectedRows?: number }
          | undefined;
        if ((header?.affectedRows ?? 0) > 0) inserted.push(row);
      }
    }
  }

  return { inserted, skipped };
}

/** 当前生效订阅：status='active' 里 period_end 最晚那条，与 GET /user/plans 的口径一致 */
async function activeSubscription(tx: LedgerTx, userId: number) {
  const [row] = await tx
    .select({ id: subscriptions.id, quotaKind: subscriptions.quotaKind })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
    .orderBy(desc(subscriptions.periodEnd))
    .limit(1);
  return row ?? null;
}

/**
 * 试吃订阅额度。够不够由 WHERE 里的 quota_used + amount <= quota_limit 判，
 * 判定与累加合成一条语句，两个人同时摄入同一用户不会把订阅额度吃超。
 * 返回 true 表示这一笔记 quota，否则把这一行留给余额。
 *
 * 只认 quota_kind='money'：requests 那档的单位是次数，收入的元没法拿去比。
 */
async function consumeQuota(
  tx: LedgerTx,
  subscription: { id: number; quotaKind: string },
  amount: number,
): Promise<boolean> {
  if (subscription.quotaKind !== "money") return false;

  const [result] = await tx
    .update(subscriptions)
    .set({ quotaUsed: sql`${subscriptions.quotaUsed} + ${decimal8(amount)}`, updatedAt: new Date() })
    .where(
      and(
        eq(subscriptions.id, subscription.id),
        sql`${subscriptions.quotaUsed} + ${decimal8(amount)} <= ${subscriptions.quotaLimit}`,
      ),
    );

  return (result?.affectedRows ?? 0) > 0;
}

/** 把这一批的 ledger 回填到 billing_records：订阅额度一组、余额一组，各写一次 */
async function markLedger(tx: LedgerTx, requestIds: string[], ledger: "quota" | "balance") {
  for (const chunk of chunkArray(requestIds, 400)) {
    await tx.update(billingRecords).set({ ledger }).where(inArray(billingRecords.requestId, chunk));
  }
}

/**
 * 摄入时扣费。走哪个口袋由本机判：有生效订阅先吃订阅额度，不够或没有订阅才走余额。
 * 一笔调用只落一种 ledger，不拆成两笔 —— 拆开之后 billing_records 与 credit_transactions
 * 就对不上了。余额不够时允许透支，与调账一致：请求已经发生，拒绝只会丢数据。
 *
 * 传进来的必须是确实新插进去的 billing 行，跳过重复时不能扣费。
 */
async function chargeBilling(tx: LedgerTx, rows: InsertRow[]) {
  // 同一用户的订阅额度按批次里的先后顺序吃，先来先占
  const byUser = new Map<number, { row: InsertRow; amount: number }[]>();
  for (const row of rows) {
    const amount = Number(row.revenueAmount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const userId = typeof row.userId === "number" ? row.userId : null;
    if (userId === null) continue;
    const list = byUser.get(userId) ?? [];
    list.push({ row, amount: round8(amount) });
    byUser.set(userId, list);
  }

  const quotaIds: string[] = [];
  const balanceIds: string[] = [];

  for (const [userId, list] of byUser) {
    const subscription = await activeSubscription(tx, userId);

    for (const { row, amount } of list) {
      const requestId = String(row.requestId);
      if (subscription && (await consumeQuota(tx, subscription, amount))) {
        quotaIds.push(requestId);
        continue;
      }

      try {
        await applyCreditTx(tx, {
          userId,
          amount: -amount,
          source: "usage",
          refId: requestId,
          model: typeof row.model === "string" ? row.model : null,
          totalTokens: typeof row.totalTokens === "number" ? row.totalTokens : null,
          ledger: "balance",
          allowOverdraft: true,
        });
        balanceIds.push(requestId);
      } catch (err) {
        // 用户被删了就没人可扣。这一行留着不扣，不因为一条脏数据把整批回滚掉
        if (!(err instanceof LedgerError) || err.code !== "user_not_found") throw err;
      }
    }
  }

  await markLedger(tx, quotaIds, "quota");
  await markLedger(tx, balanceIds, "balance");
}

/** 同一批里出现两次同一个 request_id 时只留第一条，第二条算跳过 */
function dedupeByRequestId(rows: InsertRow[]) {
  const seen = new Set<string>();
  return rows.filter(row => {
    if (seen.has(row.requestId)) return false;
    seen.add(row.requestId);
    return true;
  });
}

export type IngestResult = { inserted: number; skipped: number; invalid: number };

/**
 * 摄入一批记录。records 与 billing 都可选，一次批量提交。
 * 不属于上述字段的键直接忽略；缺 request_id 的条目计入 invalid。
 * 新插进去的 billing 行当场扣费，插行、扣费、回填 ledger 都在一个事务里。
 */
export async function ingestRecords(payload: unknown): Promise<IngestResult> {
  const body = (payload ?? {}) as { records?: unknown; billing?: unknown };
  const rawRecords = Array.isArray(body.records) ? body.records : [];
  const rawBilling = Array.isArray(body.billing) ? body.billing : [];

  let invalid = 0;
  const records: InsertRow[] = [];
  for (const raw of rawRecords) {
    const row = normalizeRequestRecord(raw);
    if (row) records.push(row);
    else invalid += 1;
  }

  const billing: InsertRow[] = [];
  for (const raw of rawBilling) {
    const row = normalizeBillingRecord(raw);
    if (row) billing.push(row);
    else invalid += 1;
  }

  const dedupedRecords = dedupeByRequestId(records);
  const dedupedBilling = dedupeByRequestId(billing);
  const inBatchDuplicates = records.length - dedupedRecords.length + (billing.length - dedupedBilling.length);

  // ledger 由本机判定，请求体里带的那个值一律丢掉
  for (const row of dedupedBilling) row.ledger = null;

  return db.transaction(async tx => {
    // 两处插入与扣费共用事务：插行成功、扣费失败会留下不一致的账
    const recordResult = await insertNew(tx, requestRecords, dedupedRecords);
    const billingResult = await insertNew(tx, billingRecords, dedupedBilling);
    await chargeBilling(tx, billingResult.inserted);

    return {
      inserted: recordResult.inserted.length + billingResult.inserted.length,
      skipped: recordResult.skipped + billingResult.skipped + inBatchDuplicates,
      invalid,
    };
  });
}

/* ------------------------------------------------------------------ 序列化 */

export function serializeRequestRecord(row: RequestRecordRow) {
  return {
    request_id: row.requestId,
    user_id: row.userId,
    api_key_id: row.apiKeyId,
    model: row.model,
    served_model: row.servedModel,
    entry: row.entry,
    stream: row.stream === 1,
    channel: row.channel,
    channel_type: row.channelType,
    base_url: row.baseUrl,
    status: row.status,
    http_status: row.httpStatus,
    error_message: row.errorMessage,
    error_code: row.errorCode,
    render_status: row.renderStatus,
    upstream_code: row.upstreamCode,
    upstream_message: row.upstreamMessage,
    panel_message: row.panelMessage,
    attempts: row.attempts,
    retried: row.retried === null ? null : row.retried === 1,
    user_agent: row.userAgent,
    reasoning_effort: row.reasoningEffort,
    latency_ms: row.latencyMs,
    ttfb_ms: row.ttfbMs,
    tps: row.tps === null ? null : Number(row.tps),
    prompt_tokens: row.promptTokens ?? 0,
    completion_tokens: row.completionTokens ?? 0,
    cache_read_tokens: row.cacheReadTokens ?? 0,
    cache_write_tokens: row.cacheWriteTokens ?? 0,
    total_tokens: row.totalTokens ?? 0,
    started_at: row.startedAt,
    finished_at: row.finishedAt,
    created_at: row.createdAt,
  };
}

/**
 * 计费流水的对外形状。paySplit 为真时补 credit_paid / balance_paid —— 
 * 本机没有把每笔账单和某条 credit_transactions 关联起来，只能按 ledger 推：
 * 走订阅额度的算信用支付，走余额的算余额支付。
 */
export function serializeBillingRecord(row: BillingRecordRow, options?: { paySplit?: boolean }) {
  const revenue = Number(row.revenueAmount);
  const split =
    row.ledger === "quota"
      ? { credit_paid: revenue, balance_paid: 0 }
      : row.ledger === "balance"
        ? { credit_paid: 0, balance_paid: revenue }
        : { credit_paid: 0, balance_paid: 0 };

  return {
    id: row.id,
    request_id: row.requestId,
    user_id: row.userId,
    api_key_id: row.apiKeyId,
    plan_id: row.planId,
    channel_id: row.channelId,
    channel_name: row.channelName,
    owner_user_id: row.ownerUserId,
    entry: row.entry,
    model: row.model,
    stream: row.stream === 1,
    usage_source: row.usageSource,
    charge_mode: row.chargeMode,
    cost_multiplier: Number(row.costMultiplier),
    cost_multiplier_rules: row.costMultiplierRules,
    cost_amount: Number(row.costAmount),
    revenue_multiplier: Number(row.revenueMultiplier),
    revenue_multiplier_rules: row.revenueMultiplierRules,
    revenue_amount: revenue,
    owner_credit_amount: Number(row.ownerCreditAmount),
    currency: row.currency,
    billing_mode: row.billingMode,
    ledger: row.ledger,
    latency_ms: row.latencyMs,
    http_status: row.httpStatus,
    attempts: row.attempts,
    retried: row.retried === null ? null : row.retried === 1,
    status: row.status,
    prompt_tokens: row.promptTokens,
    completion_tokens: row.completionTokens,
    cache_read_tokens: row.cacheReadTokens,
    cache_write_tokens: row.cacheWriteTokens,
    total_tokens: row.totalTokens,
    created_at: row.createdAt,
    ...(options?.paySplit ? split : {}),
  };
}

/* ------------------------------------------------------------- 列表与筛选 */

export type RecordListQuery = {
  userId?: number;
  keyword?: string | null;
  model?: string | null;
  userAgent?: string | null;
  status?: string | null;
  errorCode?: string | null;
  start?: Date | null;
  end?: Date | null;
  sort?: string | null;
  order?: string | null;
  size: number;
  offset: number;
};

const REQUEST_SORT_COLUMNS = {
  total_tokens: requestRecords.totalTokens,
  latency_ms: requestRecords.latencyMs,
  ttfb_ms: requestRecords.ttfbMs,
  tps: requestRecords.tps,
  created_at: requestRecords.createdAt,
} as const;

export async function listRequestRecords(query: RecordListQuery) {
  const conditions: SQL[] = [];
  if (query.userId) conditions.push(eq(requestRecords.userId, query.userId));
  if (query.keyword) {
    const pattern = likePattern(query.keyword);
    const keywordWhere = or(
      like(requestRecords.model, pattern),
      like(requestRecords.requestId, pattern),
      like(requestRecords.userAgent, pattern),
    );
    if (keywordWhere) conditions.push(keywordWhere);
  }
  if (query.model) conditions.push(eq(requestRecords.model, query.model));
  if (query.userAgent) conditions.push(eq(requestRecords.userAgent, query.userAgent));
  if (query.status) conditions.push(eq(requestRecords.status, query.status));
  if (query.errorCode) conditions.push(eq(requestRecords.errorCode, query.errorCode));
  if (query.start) conditions.push(gte(requestRecords.createdAt, query.start));
  if (query.end) conditions.push(lte(requestRecords.createdAt, query.end));

  const where = conditions.length ? and(...conditions) : undefined;

  const sortKey = (query.sort ?? "created_at") as keyof typeof REQUEST_SORT_COLUMNS;
  const sortColumn = REQUEST_SORT_COLUMNS[sortKey] ?? requestRecords.createdAt;
  const direction = query.order === "asc" ? asc : desc;

  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(requestRecords)
      .where(where)
      .orderBy(direction(sortColumn), direction(requestRecords.id))
      .limit(query.size)
      .offset(query.offset),
    db.select({ n: count() }).from(requestRecords).where(where),
  ]);

  return { items: rows.map(serializeRequestRecord), total: Number(totalRow?.n ?? 0) };
}

export type BillingListQuery = {
  userId?: number;
  apiKeyId?: number;
  model?: string | null;
  requestId?: string | null;
  channelName?: string | null;
  status?: string | null;
  charge?: string | null;
  start?: Date | null;
  end?: Date | null;
  sort?: string | null;
  order?: string | null;
  size: number;
  offset: number;
  paySplit?: boolean;
};

const BILLING_SORT_COLUMNS = {
  cost_amount: billingRecords.costAmount,
  revenue_amount: billingRecords.revenueAmount,
  total_tokens: billingRecords.totalTokens,
  created_at: billingRecords.createdAt,
} as const;

export async function listBillingRecords(query: BillingListQuery) {
  const conditions: SQL[] = [];
  if (query.userId) conditions.push(eq(billingRecords.userId, query.userId));
  if (query.apiKeyId) conditions.push(eq(billingRecords.apiKeyId, query.apiKeyId));
  if (query.model) conditions.push(eq(billingRecords.model, query.model));
  if (query.requestId) conditions.push(like(billingRecords.requestId, likePattern(query.requestId)));
  if (query.channelName) conditions.push(eq(billingRecords.channelName, query.channelName));
  if (query.status) conditions.push(eq(billingRecords.status, query.status));
  if (query.charge === "free") conditions.push(lte(billingRecords.revenueAmount, "0"));
  if (query.charge === "paid") conditions.push(sql`${billingRecords.revenueAmount} > 0`);
  if (query.start) conditions.push(gte(billingRecords.createdAt, query.start));
  if (query.end) conditions.push(lte(billingRecords.createdAt, query.end));

  const where = conditions.length ? and(...conditions) : undefined;

  const sortKey = (query.sort ?? "created_at") as keyof typeof BILLING_SORT_COLUMNS;
  const sortColumn = BILLING_SORT_COLUMNS[sortKey] ?? billingRecords.createdAt;
  const direction = query.order === "asc" ? asc : desc;

  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(billingRecords)
      .where(where)
      .orderBy(direction(sortColumn), direction(billingRecords.id))
      .limit(query.size)
      .offset(query.offset),
    db.select({ n: count() }).from(billingRecords).where(where),
  ]);

  return {
    items: rows.map(row => serializeBillingRecord(row, { paySplit: query.paySplit })),
    total: Number(totalRow?.n ?? 0),
  };
}

/** 筛选项：表里出现过的模型与 user agent。传 userId 就只看这个用户的 */
export async function requestRecordFilters(userId?: number) {
  const where = userId ? eq(requestRecords.userId, userId) : undefined;

  const [modelRows, agentRows] = await Promise.all([
    db
      .selectDistinct({ value: requestRecords.model })
      .from(requestRecords)
      .where(where)
      .orderBy(asc(requestRecords.model))
      .limit(500),
    db
      .selectDistinct({ value: requestRecords.userAgent })
      .from(requestRecords)
      .where(where)
      .orderBy(asc(requestRecords.userAgent))
      .limit(500),
  ]);

  return {
    models: modelRows.map(row => row.value).filter((value): value is string => !!value && value.length > 0),
    user_agents: agentRows.map(row => row.value).filter((value): value is string => !!value && value.length > 0),
  };
}

/* ------------------------------------------------------------ 用量与概览 */

export type UsageModelSlice = { model: string; requests: number; tokens: number; revenue: number };
export type UsagePoint = {
  date: string;
  requests: number;
  tokens: number;
  revenue: number;
  models: UsageModelSlice[];
};

/** UTC 零点。数据库连接按 UTC 解析，DATE_FORMAT 出来的也是 UTC 的日期 */
function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** 从 from 到今天的连续日序列（含两端），缺数据的日子也会补 0 */
function dayKeysFor(days: number) {
  const today = startOfUtcDay(new Date());
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    keys.push(new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  }
  return keys;
}

/**
 * 按天的用量序列。
 *
 * requests / tokens 来自 request_records（含失败调用），revenue 来自 billing_records，
 * 所以「请求数」与「收入」各自跟自己的明细表对得上。模型拆分把两边按
 * （天，模型）合并：requests / tokens 取请求记录，revenue 取账单。
 */
export async function usageSeries(options: { days: number; userId?: number }): Promise<UsagePoint[]> {
  const days = Math.min(90, Math.max(1, Math.floor(options.days)));
  const keys = dayKeysFor(days);
  const from = new Date(`${keys[0]}T00:00:00.000Z`);

  const recordConditions: SQL[] = [gte(requestRecords.createdAt, from)];
  if (options.userId) recordConditions.push(eq(requestRecords.userId, options.userId));

  const billingConditions: SQL[] = [gte(billingRecords.createdAt, from)];
  if (options.userId) billingConditions.push(eq(billingRecords.userId, options.userId));

  const recordDay = sql<string>`DATE_FORMAT(${requestRecords.createdAt}, '%Y-%m-%d')`;
  const billingDay = sql<string>`DATE_FORMAT(${billingRecords.createdAt}, '%Y-%m-%d')`;

  const [recordRows, billingRows] = await Promise.all([
    db
      .select({
        day: recordDay,
        model: requestRecords.model,
        requests: count(),
        tokens: sql<string>`COALESCE(SUM(${requestRecords.totalTokens}), 0)`,
      })
      .from(requestRecords)
      .where(and(...recordConditions))
      .groupBy(recordDay, requestRecords.model),
    db
      .select({
        day: billingDay,
        model: billingRecords.model,
        revenue: sql<string>`COALESCE(SUM(${billingRecords.revenueAmount}), 0)`,
      })
      .from(billingRecords)
      .where(and(...billingConditions))
      .groupBy(billingDay, billingRecords.model),
  ]);

  type Bucket = { requests: number; tokens: number; revenue: number; models: Map<string, UsageModelSlice> };
  const buckets = new Map<string, Bucket>();
  for (const key of keys) buckets.set(key, { requests: 0, tokens: 0, revenue: 0, models: new Map() });

  const sliceFor = (bucket: Bucket, model: string) => {
    const existing = bucket.models.get(model);
    if (existing) return existing;
    const created: UsageModelSlice = { model, requests: 0, tokens: 0, revenue: 0 };
    bucket.models.set(model, created);
    return created;
  };

  for (const row of recordRows) {
    const bucket = buckets.get(String(row.day));
    if (!bucket) continue;
    bucket.requests += Number(row.requests);
    bucket.tokens += Number(row.tokens);
    if (row.model) {
      const slice = sliceFor(bucket, row.model);
      slice.requests += Number(row.requests);
      slice.tokens += Number(row.tokens);
    }
  }

  for (const row of billingRows) {
    const bucket = buckets.get(String(row.day));
    if (!bucket) continue;
    const revenue = Number(row.revenue);
    bucket.revenue += revenue;
    if (row.model) sliceFor(bucket, row.model).revenue += revenue;
  }

  return keys.map(key => {
    const bucket = buckets.get(key)!;
    return {
      date: key,
      requests: bucket.requests,
      tokens: bucket.tokens,
      revenue: Math.round(bucket.revenue * 1e8) / 1e8,
      models: [...bucket.models.values()],
    };
  });
}

export type DashboardSummary = {
  last_24h: { requests: number; success: number; success_rate: number; cost: number; revenue: number };
  low_balance_users: number;
};

/** 概览：固定最近 24 小时，外加余额加授信不大于 0 的启用用户数 */
export async function dashboardSummary(): Promise<DashboardSummary> {
  const from = new Date(Date.now() - 24 * 3_600_000);

  const [requestAgg, billingAgg, [lowRow]] = await Promise.all([
    db
      .select({
        requests: count(),
        success: sql<string>`COALESCE(SUM(CASE WHEN ${requestRecords.status} = 'success' THEN 1 ELSE 0 END), 0)`,
      })
      .from(requestRecords)
      .where(gte(requestRecords.createdAt, from)),
    db
      .select({
        cost: sql<string>`COALESCE(SUM(${billingRecords.costAmount}), 0)`,
        revenue: sql<string>`COALESCE(SUM(${billingRecords.revenueAmount}), 0)`,
      })
      .from(billingRecords)
      .where(gte(billingRecords.createdAt, from)),
    db
      .select({ n: count() })
      .from(users)
      .where(
        and(
          eq(users.status, 1),
          sql`(${users.balance} + (${users.creditLimit} - ${users.creditUsed})) <= 0`,
        ),
      ),
  ]);

  const requests = Number(requestAgg[0]?.requests ?? 0);
  const success = Number(requestAgg[0]?.success ?? 0);

  return {
    last_24h: {
      requests,
      success,
      success_rate: requests > 0 ? Math.round((success / requests) * 10_000) / 100 : 0,
      cost: Number(billingAgg[0]?.cost ?? 0),
      revenue: Number(billingAgg[0]?.revenue ?? 0),
    },
    low_balance_users: Number(lowRow?.n ?? 0),
  };
}

/** 把用量序列裁成概览需要的 {day, requests, revenue} 形状 */
export function toDashboardUsage(series: UsagePoint[]) {
  return series.map(point => ({
    day: point.date,
    requests: point.requests,
    revenue: point.revenue,
  }));
}
