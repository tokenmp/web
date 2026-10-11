import type { APIEvent } from "@solidjs/start/server";
import { and, desc, eq, ne, sql } from "drizzle-orm";

import { guardAdmin } from "~/lib/api-auth";
import { hashPassword } from "~/lib/auth";
import { duplicateMessageFor } from "~/lib/db-error";
import { db } from "~/lib/db";
import { errorJson, json, num } from "~/lib/http";
import { decimal8 } from "~/lib/ledger";
import { subscriptions, userBudgets, users, type UserBudgetRow, type UserRow } from "~/lib/schema";
import { checkMoney, checkText } from "~/lib/validate";

function parseId(raw: string | undefined) {
  const id = Number(raw);
  // 必须是整数：1.5 以前算合法 id 然后查不到，回了 404；
  // openapi 把非整数归 400，两者要分得开
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** User schema 的形状，与 users.ts 保持一致（路由之间不互相 import） */
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

/** 没设过预算的用户也回完整形状，不报 404 */
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

/** GET /api/admin/users/{id} —— 用户详情，含余额、预算与订阅快照 */
export async function GET({ request, params }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const id = parseId(params.id);
  if (!id) return errorJson("用户 id 不合法", 400);

  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) return errorJson("用户不存在", 404);

  const [[budget], [sub]] = await Promise.all([
    db.select().from(userBudgets).where(eq(userBudgets.userId, id)).limit(1),
    db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, id), eq(subscriptions.status, "active")))
      .orderBy(desc(subscriptions.periodEnd))
      .limit(1),
  ]);

  return json({
    data: {
      ...userCore(row),
      balance: num(row.balance),
      budget: budgetView(id, budget),
      subscription: sub
        ? {
            plan_id: sub.planId,
            quota_kind: sub.quotaKind,
            quota_limit: num(sub.quotaLimit),
            quota_used: num(sub.quotaUsed),
            period_start: sub.periodStart,
            period_end: sub.periodEnd,
          }
        : null,
    },
  });
}

/**
 * PUT /api/admin/users/{id}
 *
 * 字段全部可选，不传就不动。判断用 `!== undefined` 而不是 `??` ——
 * `plan_id: null` 是有意义的输入（解绑），`??` 会把它当成没传。
 * 改密码时把 token_version 加一，已经签发的会话当场失效。
 */
export async function PUT({ request, params }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const id = parseId(params.id);
  if (!id) return errorJson("用户 id 不合法", 400);

  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求体不是合法 JSON", 400);
  }

  const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!existing) return errorJson("用户不存在", 404);

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (body?.name !== undefined) {
    // 只认字符串，不把对象强转成 [object Object]
    const nameProblem = checkText(body.name, "用户名", 64);
    if (nameProblem) return errorJson(nameProblem, 400);
    const name = (body.name as string).trim();
    const [dup] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.name, name), ne(users.id, id)))
      .limit(1);
    if (dup) return errorJson("用户名已存在", 409);
    patch.name = name;
  }

  if (body?.email !== undefined) {
    // 显式传 null 或空串表示清掉邮箱
    if (body.email !== null && typeof body.email !== "string") {
      return errorJson("邮箱必须是字符串", 400);
    }
    const email = body.email === null ? "" : body.email.trim().toLowerCase();
    if (email.length > 191) return errorJson("邮箱过长", 400);
    if (email) {
      const [dup] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, email), ne(users.id, id)))
        .limit(1);
      if (dup) return errorJson("邮箱已存在", 409);
    }
    patch.email = email || null;
  }

  if (body?.password !== undefined && body?.password !== null) {
    if (typeof body.password !== "string") return errorJson("密码必须是字符串", 400);
    const plain = body.password;
    if (plain.length < 8) return errorJson("密码至少 8 位", 400);
    patch.passwordHash = hashPassword(plain);
    // 自增交给数据库，避免「先读再加一」在并发下少加
    patch.tokenVersion = sql`token_version + 1`;
  }

  if (body?.status !== undefined) {
    // 只认数字 0/1。之前用 Number() 强转，status=true 会变成 1，
    // status=null 会变成 0 —— 后者等于静默把用户停用了
    if (typeof body.status !== "number" || (body.status !== 0 && body.status !== 1)) {
      return errorJson("status 只能是数字 0 或 1", 400);
    }
    patch.status = body.status;
  }

  if (body?.role !== undefined) {
    const role = String(body.role);
    if (role !== "user" && role !== "admin") return errorJson("role 只能是 user 或 admin", 400);
    patch.role = role;
  }

  if (body?.credit_limit !== undefined && body?.credit_limit !== null) {
    // 与新建时的口径保持一致：只认数字，且要在 DECIMAL(14,8) 能表示的范围内，
    // 授信额度是「最多能欠多少」，负数没有意义
    if (typeof body.credit_limit !== "number") return errorJson("信用额度必须是数字", 400);
    const problem = checkMoney(body.credit_limit, "信用额度");
    if (problem) return errorJson(problem, 400);
    if (body.credit_limit < 0) return errorJson("信用额度必须是不小于 0 的数字", 400);
    patch.creditLimit = decimal8(body.credit_limit);
  }

  if (body?.plan_id !== undefined) {
    if (body.plan_id === null) {
      patch.planId = null;
    } else {
      if (typeof body.plan_id !== "number" || !Number.isInteger(body.plan_id) || body.plan_id <= 0) {
        return errorJson("plan_id 必须是正整数", 400);
      }
      patch.planId = body.plan_id;
    }
  }

  try {
    await db.update(users).set(patch).where(eq(users.id, id));
  } catch (err) {
    // 并发下预检查会放过，真撞上唯一键要在这里翻成 409 ——
    // 错误包裹在 err.cause 里，交给 db-error 解
    const dup = duplicateMessageFor(err, { uk_users_email: "邮箱已存在" }, "用户名已存在");
    if (dup) return errorJson(dup, 409);
    throw err;
  }

  return json({ ok: true });
}

/**
 * DELETE /api/admin/users/{id}
 *
 * 软删：只把 status 置 0，余额与流水全部保留 —— 账不能因为停用就消失。
 * 用户不存在也回成功，openapi 明说这是幂等操作。
 */
export async function DELETE({ request, params }: APIEvent) {
  const guard = await guardAdmin(request);
  if ("error" in guard) return guard.error;
  const admin = guard.user;

  const id = parseId(params.id);
  if (!id) return errorJson("用户 id 不合法", 400);

  await db.update(users).set({ status: 0, updatedAt: new Date() }).where(eq(users.id, id));
  return json({ ok: true });
}
