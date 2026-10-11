import type { APIEvent } from "@solidjs/start/server";
import { and, asc, count, desc, eq, inArray, like, or } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { hashPassword } from "~/lib/auth";
import { duplicateMessageFor } from "~/lib/db-error";
import { db } from "~/lib/db";
import { errorJson, json, num, parsePaging } from "~/lib/http";
import { decimal8 } from "~/lib/ledger";
import { checkMoney, checkText } from "~/lib/validate";
import {
  subscriptions,
  userBudgets,
  users,
  type SubscriptionRow,
  type UserBudgetRow,
  type UserRow,
} from "~/lib/schema";

/**
 * User schema 的形状。credit_limit 是 decimal 列，drizzle 读出来是字符串，
 * 这里过一遍 num() 换成数字；password_hash 一次都不出口。
 */
function userCore(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    credit_limit: num(row.creditLimit),
    plan_id: row.planId,
    token_version: row.tokenVersion,
    source: row.source,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/** 没设过预算的用户也要有完整形状，页面才不用到处判空 */
function budgetView(userId: number, row?: UserBudgetRow) {
  if (!row) {
    return {
      user_id: userId,
      enabled: 0,
      amount: 0,
      period: "month",
      period_start: null,
      period_end: null,
      used: 0,
      version: 0,
      updated_at: null,
    };
  }
  return {
    user_id: userId,
    // enabled 是库里的列，openapi 的 UserBudget 没写它，但页面要用，这里多带一个
    enabled: row.enabled,
    amount: num(row.amount),
    period: row.period,
    period_start: row.periodStart,
    period_end: row.periodEnd,
    used: num(row.used),
    version: row.version,
    updated_at: row.updatedAt,
  };
}

function subscriptionView(row?: SubscriptionRow) {
  if (!row) return null;
  return {
    plan_id: row.planId,
    quota_kind: row.quotaKind,
    quota_limit: num(row.quotaLimit),
    quota_used: num(row.quotaUsed),
    period_start: row.periodStart,
    period_end: row.periodEnd,
  };
}

/**
 * 一次把这一页用户的预算与当前订阅查出来。
 * 逐条查会是 N+1 —— 一页 100 个用户就是 200 次往返，列表接口撑不住。
 */
async function buildUserViews(rows: UserRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map(row => row.id);

  const [budgets, subs] = await Promise.all([
    db.select().from(userBudgets).where(inArray(userBudgets.userId, ids)),
    db
      .select()
      .from(subscriptions)
      .where(and(inArray(subscriptions.userId, ids), eq(subscriptions.status, "active")))
      // period_end 降序，每个用户取第一条就是「最新的一次激活」；
      // mysql 的 DESC 把 NULL 排在最后，所以没填周期的那条不会顶掉有周期的
      .orderBy(desc(subscriptions.periodEnd)),
  ]);

  const budgetMap = new Map(budgets.map(row => [row.userId, row]));
  const subMap = new Map<number, SubscriptionRow>();
  for (const sub of subs) {
    if (!subMap.has(sub.userId)) subMap.set(sub.userId, sub);
  }

  return rows.map(row => ({
    ...userCore(row),
    balance: num(row.balance),
    budget: budgetView(row.id, budgetMap.get(row.id)),
    subscription: subscriptionView(subMap.get(row.id)),
  }));
}

/** keyword 里的 % 与 _ 是 LIKE 通配符，用户要搜的是字面字符，转义掉才算模糊匹配 */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, ch => `\\${ch}`);
}

/** 没给密码时用的占位明文。随即丢弃，不会出现在任何响应或日志里 */
function placeholderSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 用户名与邮箱上都有唯一索引，并发下预检查可能同时通过。
 *
 * 错误要交给 db-error 去解：drizzle 把驱动错误包了一层，
 * 外层 err.code 永远是 undefined，直接判 ER_DUP_ENTRY 会永远判不出来，于是回 500。
 */
function duplicateMessage(err: unknown) {
  return duplicateMessageFor(err, { uk_users_email: "邮箱已存在" }, "用户名已存在");
}

/**
 * GET /api/admin/users
 *
 * 查询参数：page、size、keyword（按用户名或邮箱模糊匹配）、status、sort、order。
 * status 取 1（正常）或 0（已封禁）；非法值当没给，不过滤、不报错 ——
 * 跟 sort、order 一个口径，前端多传一个空串不该让整个列表挂掉。
 * order 只有 asc 生效，其余一律降序 —— openapi 就是这么定的。
 *
 * 注意 total 是**过滤后**的总数，跟 items 同一套 where，页码条直接拿它算页数。
 */
export async function GET({ request }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const url = new URL(request.url);
  const { size, offset } = parsePaging(url);

  const keyword = (url.searchParams.get("keyword") ?? "").trim();
  // 用户名与邮箱都要命中：管理端常常只记得邮箱，只搜用户名等于搜不到
  const pattern = `%${escapeLike(keyword)}%`;

  const rawStatus = url.searchParams.get("status");
  const status = rawStatus === "1" ? 1 : rawStatus === "0" ? 0 : undefined;

  const filters = [
    keyword ? or(like(users.name, pattern), like(users.email, pattern)) : undefined,
    status !== undefined ? eq(users.status, status) : undefined,
  ];
  // and() 会把 undefined 的项丢掉，两项都没有时回 undefined，正好当「不过滤」
  const where = and(...filters);

  const sort = url.searchParams.get("sort");
  const column =
    sort === "credit_limit"
      ? users.creditLimit
      : sort === "name"
        ? users.name
        : sort === "updated_at"
          ? users.updatedAt
          : users.createdAt;
  const direction = url.searchParams.get("order") === "asc" ? asc : desc;

  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(users)
      .where(where)
      .orderBy(direction(column))
      .limit(size)
      .offset(offset),
    db.select({ n: count() }).from(users).where(where),
  ]);

  return json({ items: await buildUserViews(rows), total: Number(total?.n ?? 0) });
}

/**
 * POST /api/admin/users
 *
 * 建号。name 必填，其余可选。没给 password 时用随机串的哈希占位 ——
 * password_hash 是 NOT NULL，但管理员建号时往往只想先把账号和额度立起来；
 * 占位明文立即丢弃，没人知道它，账号等于「已建但还不能登录」，
 * 之后用 PUT 设密码即可。
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

  // 只认字符串。之前用 String(body?.name ?? "") 强转，传 {} 会建出一个叫 [object Object] 的账号
  const nameProblem = checkText(body?.name, "用户名", 64);
  if (nameProblem) return errorJson(nameProblem, 400);
  const name = (body?.name as string).trim();

  let creditLimit = 0;
  if (body?.credit_limit !== undefined && body?.credit_limit !== null) {
    if (typeof body.credit_limit !== "number") return errorJson("信用额度必须是数字", 400);
    const problem = checkMoney(body.credit_limit, "信用额度");
    if (problem) return errorJson(problem, 400);
    if (body.credit_limit < 0) return errorJson("信用额度必须是不小于 0 的数字", 400);
    creditLimit = body.credit_limit;
  }

  let planId: number | null = null;
  if (body?.plan_id !== undefined && body?.plan_id !== null) {
    if (typeof body.plan_id !== "number" || !Number.isInteger(body.plan_id) || body.plan_id <= 0) {
      return errorJson("plan_id 必须是正整数", 400);
    }
    planId = body.plan_id;
  }

  // 邮箱跟 login 一样归一：trim + 小写，否则同一个邮箱大小写不同会建出两个号
  let email: string | null = null;
  if (body?.email !== undefined && body?.email !== null) {
    if (typeof body.email !== "string") return errorJson("邮箱必须是字符串", 400);
    email = body.email.trim().toLowerCase() || null;
    if (email && email.length > 191) return errorJson("邮箱过长", 400);
  }

  let passwordHash: string;
  if (body?.password !== undefined && body?.password !== null && String(body.password) !== "") {
    const plain = String(body.password);
    if (plain.length < 8) return errorJson("密码至少 8 位", 400);
    passwordHash = hashPassword(plain);
  } else {
    passwordHash = hashPassword(placeholderSecret());
  }

  const [dupName] = await db.select({ id: users.id }).from(users).where(eq(users.name, name)).limit(1);
  if (dupName) return errorJson("用户名已存在", 409);
  if (email) {
    const [dupEmail] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (dupEmail) return errorJson("邮箱已存在", 409);
  }

  const now = new Date();
  let newId: number;
  try {
    const [created] = await db
      .insert(users)
      .values({
        name,
        email,
        passwordHash,
        role: "user",
        status: 1,
        creditLimit: decimal8(creditLimit),
        balance: "0",
        creditUsed: "0",
        planId,
        tokenVersion: 0,
        source: "local",
        createdAt: now,
        updatedAt: now,
      })
      .$returningId();
    newId = created.id;
  } catch (err) {
    const dup = duplicateMessage(err);
    if (dup) return errorJson(dup, 409);
    throw err;
  }

  const [row] = await db.select().from(users).where(eq(users.id, newId)).limit(1);
  return json({ data: userCore(row) });
}
