/**
 * 业务接口的端到端验证。
 *
 * 不起服务器：直接把路由的 handler 拿来调，给一个带会话 cookie 的 `Request`。
 * 会话是无状态 JWT，用 src/lib/auth.ts 的 signSession 现签一个即可，
 * 不用走登录流程，也不用知道库里管理员的密码。
 *
 *   bun test                 # 需要本地库在跑（sudo docker compose up -d）
 *   bun test tests/api.test.ts
 *
 * 前提：库里有至少一个 status=1 的 admin（用来签管理员会话），以及五条种子套餐。
 * 每个用例自己建测试用户与测试套餐，结束后删干净，可以反复跑。
 *
 * 为什么不用 createResource / 起 dev server：那需要端口与重启，多个用例会互相抢；
 * 直接调 handler 每个用例都是独立的，失败信息也更干净。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import mysql from "mysql2/promise";

import { signSession } from "../src/lib/auth";
import { db } from "../src/lib/db";
import { users } from "../src/lib/schema";

import { GET as adminUsersGet, POST as adminUsersPost } from "../src/routes/api/admin/users";
import { DELETE as adminUserDel, GET as adminUserGet, PUT as adminUserPut } from "../src/routes/api/admin/users/[id]";
import { PUT as budgetPut } from "../src/routes/api/admin/users/[id]/budget";
import { GET as adminKeysGet } from "../src/routes/api/admin/users/[id]/api_keys";
import { DELETE as adminKeyDel } from "../src/routes/api/admin/api_keys/[id]";
import { GET as myKeysGet, POST as myKeysPost } from "../src/routes/api/user/api_keys";
import { POST as adjustPost } from "../src/routes/api/admin/balances/adjust";
import { GET as logsGet } from "../src/routes/api/admin/adjust-logs";
import { GET as creditsGet } from "../src/routes/api/user/credits";
import { GET as meGet } from "../src/routes/api/user/me";
import { GET as plansGet, POST as plansPost } from "../src/routes/api/admin/plans";
import { DELETE as planDel, GET as planGet } from "../src/routes/api/admin/plans/[id]";
import { POST as pricePost } from "../src/routes/api/admin/plans/[id]/prices";
import { DELETE as priceDel } from "../src/routes/api/admin/plan_prices/[id]";
import { GET as activationsGet } from "../src/routes/api/admin/plan-activations";
import { GET as summaryGet } from "../src/routes/api/admin/plan-activations/summary";
import { GET as historyGet } from "../src/routes/api/admin/plan-activations/[user_id]/history";
import { GET as myPlansGet } from "../src/routes/api/user/plans";
import { POST as subscribePost } from "../src/routes/api/user/plans/[id]/subscribe";
import { POST as apiKeyLookupPost } from "../src/routes/api/internal/api-key";
import { POST as recordsIngestPost } from "../src/routes/api/internal/records";
import { POST as rechargeCallbackPost } from "../src/routes/api/internal/recharge-callback";

// 两把共享密钥写死在这里，不依赖 .env，测试才能反复跑
process.env.RECORDS_CALLBACK_SECRET = "t-e2e-records-secret";
process.env.RECHARGE_CALLBACK_SECRET = "t-e2e-recharge-secret";

const recordsSecretHeaders: Record<string, string> = { "x-callback-secret": "t-e2e-records-secret" };
const rechargeSecretHeaders: Record<string, string> = { "x-callback-secret": "t-e2e-recharge-secret" };

type Handler = (event: unknown) => Promise<Response>;

type CallOptions = {
  method?: string;
  path: string;
  body?: unknown;
  token?: string | null;
  params?: Record<string, string>;
  headers?: Record<string, string>;
};

/** 按 handler 的约定拼一个 Request：会话走 cookie，参数走 params，体走 JSON */
async function call(handler: unknown, options: CallOptions) {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token) headers.cookie = `tokenmp_session=${options.token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const request = new Request(`http://localhost:6789${options.path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const response = await (handler as Handler)({ request, params: options.params ?? {} });
  const text = await response.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // 不是 JSON 就保留原文，断言失败时能看见服务端到底回了什么
  }
  return { status: response.status, body };
}

const conn = await mysql.createConnection(
  process.env.DATABASE_URL ?? "mysql://tokenmp:tokenmp-dev@127.0.0.1:3307/tokenmp",
);

const stamp = Date.now();
const userName = `t-e2e-${stamp}`;
const planName = `t-e2e-套餐-${stamp}`;

let adminToken = "";
let adminName = "";
let userId = 0;
let userToken = "";
let planId = 0;

/** 把测试用户恢复到干净起点：余额、授信、预算、客户端密钥、流水、订阅全清 */
async function resetUser() {
  await conn.query("DELETE FROM credit_transactions WHERE user_id = ?", [userId]);
  await conn.query("DELETE FROM subscriptions WHERE user_id = ?", [userId]);
  await conn.query("DELETE FROM api_keys WHERE user_id = ?", [userId]);
  await conn.query("DELETE FROM user_budgets WHERE user_id = ?", [userId]);
  await conn.query("UPDATE users SET balance = 0, credit_used = 0, credit_limit = 50, plan_id = NULL, status = 1 WHERE id = ?", [userId]);
}

beforeAll(async () => {
  const [admin] = await db.select().from(users).where(eq(users.role, "admin")).limit(1);
  if (!admin) throw new Error("库里没有管理员账号，先跑一次 db/init 或者手工建一个");
  adminToken = await signSession({ sub: admin.id, tv: admin.tokenVersion, role: admin.role });
  adminName = admin.name;

  const created = await call(adminUsersPost, {
    method: "POST",
    path: "/api/admin/users",
    token: adminToken,
    body: { name: userName, credit_limit: 50, email: `${userName}@example.com` },
  });
  if (created.status !== 200) throw new Error(`建测试用户失败：${JSON.stringify(created.body)}`);
  userId = created.body.data.id;
  userToken = await signSession({ sub: userId, tv: 0, role: "user" });

  const plan = await call(plansPost, {
    method: "POST",
    path: "/api/admin/plans",
    token: adminToken,
    body: {
      name: planName,
      mode: "subscription",
      pricing_mode: "table",
      quota_kind: "money",
      quota_amount: 10,
      quota_period_days: 30,
      price: 10,
      currency: "CNY",
    },
  });
  if (plan.status !== 200) throw new Error(`建测试套餐失败：${JSON.stringify(plan.body)}`);
  planId = plan.body.data.id;
});

afterAll(async () => {
  await conn.query("DELETE FROM credit_transactions WHERE user_id = ?", [userId]);
  await conn.query("DELETE FROM subscriptions WHERE user_id = ? OR plan_id = ?", [userId, planId]);
  await conn.query("DELETE FROM api_keys WHERE user_id = ?", [userId]);
  await conn.query("DELETE FROM user_budgets WHERE user_id = ?", [userId]);
  await conn.query("DELETE FROM billing_records WHERE request_id LIKE 't-e2e-%'");
  await conn.query("DELETE FROM request_records WHERE request_id LIKE 't-e2e-%'");
  await conn.query("DELETE FROM plan_prices WHERE plan_id = ?", [planId]);
  await conn.query("DELETE FROM plans WHERE id = ?", [planId]);
  if (userId) await conn.query("DELETE FROM users WHERE id = ?", [userId]);
  await conn.end();

  const [leftover] = (await db.execute(
    "SELECT (SELECT COUNT(*) FROM users WHERE name LIKE 't-e2e-%') u, (SELECT COUNT(*) FROM plans WHERE name LIKE 't-e2e-%') p",
  )) as unknown as [Array<{ u: number; p: number }>];
  expect([Number(leftover[0].u), Number(leftover[0].p)]).toEqual([0, 0]);
});

describe("鉴权与参数校验", () => {
  test("未登录回 401，登录了但非管理员回 403", async () => {
    expect((await call(adminUsersGet, { path: "/api/admin/users" })).status).toBe(401);
    expect((await call(meGet, { path: "/api/user/me" })).status).toBe(401);
    expect((await call(adminUsersGet, { path: "/api/admin/users", token: userToken })).status).toBe(403);
  });

  test("调账的参数校验", async () => {
    const base = { user_id: userId, amount: 10, reason: "测试" };
    const adjust = (body: unknown) =>
      call(adjustPost, { method: "POST", path: "/api/admin/balances/adjust", token: adminToken, body });

    expect((await adjust({ ...base, amount: 0 })).status).toBe(400);
    expect((await adjust({ ...base, amount: "10" })).status).toBe(400);
    expect((await adjust({ ...base, amount: Number.NaN })).status).toBe(400);
    expect((await adjust({ user_id: userId, amount: 10 })).status).toBe(400);
    expect((await adjust({ ...base, reason: "" })).status).toBe(400);
    expect((await adjust({ ...base, reason: "x".repeat(257) })).status).toBe(400);
    expect((await adjust({ ...base, source: "gift" })).status).toBe(400);
    expect((await adjust({ ...base, user_id: 99999999 })).status).toBe(404);
  });

  test("不存在的用户回 404，id 不合法回 400", async () => {
    expect((await call(adminUserGet, { path: "/api/admin/users/99999999", token: adminToken, params: { id: "99999999" } })).status).toBe(404);
    expect((await call(adminUserGet, { path: "/api/admin/users/abc", token: adminToken, params: { id: "abc" } })).status).toBe(400);
  });

  test("密钥列表不返回明文", async () => {
    const issued = await call(myKeysPost, { method: "POST", path: "/api/user/api_keys", token: userToken, body: { name: "看着用的" } });
    expect(issued.status).toBe(200);

    const listed = await call(myKeysGet, { path: "/api/user/api_keys", token: userToken });
    const row = listed.body.items[0];
    expect(row.key).toBeUndefined();
    expect(row.key_hash).toBeUndefined();

    // 库里存的必须是哈希，明文一点都不能留
    const [rows] = (await conn.query("SELECT key_hash FROM api_keys WHERE user_id = ?", [userId])) as any[];
    expect(rows[0].key_hash).toHaveLength(64);
    expect(rows[0].key_hash).not.toContain(issued.body.data.key);
    await resetUser();
  });
});

describe("用户管理", () => {
  test("列表、详情与预算", async () => {
    await resetUser();

    const listed = await call(adminUsersGet, { path: `/api/admin/users?keyword=${userName}`, token: adminToken });
    expect(listed.body.total).toBe(1);
    const row = listed.body.items[0];
    expect(row.balance).toBe(0);
    expect(row.subscription).toBeNull();
    expect(row.password_hash).toBeUndefined();
    // 没设过预算也要给完整形状，页面才不用到处判空
    expect([row.budget.amount, row.budget.period, row.budget.enabled]).toEqual([0, "month", 0]);

    const set = await call(budgetPut, {
      method: "PUT",
      path: `/api/admin/users/${userId}/budget`,
      token: adminToken,
      params: { id: String(userId) },
      body: { enabled: true, amount: 30, period: "day" },
    });
    expect([set.body.data.enabled, set.body.data.amount, set.body.data.period]).toEqual([1, 30, "day"]);

    const detail = await call(adminUserGet, { path: `/api/admin/users/${userId}`, token: adminToken, params: { id: String(userId) } });
    expect(detail.body.data.budget.amount).toBe(30);

    // 关开关或把金额填 0 都算清除，两个条件都要判
    const off = await call(budgetPut, {
      method: "PUT",
      path: `/api/admin/users/${userId}/budget`,
      token: adminToken,
      params: { id: String(userId) },
      body: { enabled: false, amount: 30, period: "day" },
    });
    expect([off.body.data.enabled, off.body.data.amount]).toEqual([0, 0]);

    const zero = await call(budgetPut, {
      method: "PUT",
      path: `/api/admin/users/${userId}/budget`,
      token: adminToken,
      params: { id: String(userId) },
      body: { enabled: true, amount: 0, period: "month" },
    });
    expect([zero.body.data.enabled, zero.body.data.amount]).toEqual([0, 0]);
  });

  test("改用户：不传的不动、null 解绑、改密码顶掉旧会话", async () => {
    await resetUser();
    const path = `/api/admin/users/${userId}`;
    const put = (body: unknown) => call(adminUserPut, { method: "PUT", path, token: adminToken, params: { id: String(userId) }, body });

    expect((await put({ credit_limit: -1 })).status).toBe(400);
    expect((await put({ status: 7 })).status).toBe(400);
    expect((await put({ role: "root" })).status).toBe(400);
    expect((await put({ password: "short" })).status).toBe(400);

    expect((await put({ plan_id: planId })).status).toBe(200);
    expect((await put({ credit_limit: 80 })).status).toBe(200);
    const [after] = (await conn.query("SELECT plan_id, credit_limit, token_version FROM users WHERE id = ?", [userId])) as any[];
    // 只改了 credit_limit，plan_id 没有被顺带清掉
    expect([after[0].plan_id, after[0].credit_limit, after[0].token_version]).toEqual([planId, "80.00000000", 0]);

    expect((await put({ plan_id: null })).status).toBe(200);
    const [unbound] = (await conn.query("SELECT plan_id FROM users WHERE id = ?", [userId])) as any[];
    expect(unbound[0].plan_id).toBeNull();

    expect((await put({ password: "a-long-enough-one" })).status).toBe(200);
    const [rotated] = (await conn.query("SELECT token_version FROM users WHERE id = ?", [userId])) as any[];
    expect(rotated[0].token_version).toBe(1);
    // 旧会话的 tv 还是 0，应当当场失效
    expect((await call(meGet, { path: "/api/user/me", token: userToken })).status).toBe(401);
    userToken = await signSession({ sub: userId, tv: 1, role: "user" });
    expect((await call(meGet, { path: "/api/user/me", token: userToken })).status).toBe(200);

    await conn.query("UPDATE users SET token_version = 0 WHERE id = ?", [userId]);
    userToken = await signSession({ sub: userId, tv: 0, role: "user" });
  });

  test("重名与重邮箱回 409", async () => {
    const post = (body: unknown) => call(adminUsersPost, { method: "POST", path: "/api/admin/users", token: adminToken, body });
    expect((await post({ name: userName })).status).toBe(409);
    expect((await post({ name: `${userName}-另一个`, email: `${userName}@example.com` })).status).toBe(409);
  });

  test("停用是软删，余额与流水都留着", async () => {
    await resetUser();
    await call(adjustPost, { method: "POST", path: "/api/admin/balances/adjust", token: adminToken, body: { user_id: userId, amount: 40, reason: "先记一笔", source: "recharge" } });

    const path = `/api/admin/users/${userId}`;
    expect((await call(adminUserDel, { method: "DELETE", path, token: adminToken, params: { id: String(userId) } })).status).toBe(200);
    // 幂等：再删一次也回成功
    expect((await call(adminUserDel, { method: "DELETE", path, token: adminToken, params: { id: String(userId) } })).status).toBe(200);

    const [row] = (await conn.query("SELECT status, balance FROM users WHERE id = ?", [userId])) as any[];
    expect([row[0].status, row[0].balance]).toEqual([0, "40.00000000"]);
    await resetUser();
  });
});

describe("充值、调账与账本", () => {
  test("入账先冲抵授信，扣款先扣余额再用授信", async () => {
    await resetUser();
    const adjust = (body: unknown) => call(adjustPost, { method: "POST", path: "/api/admin/balances/adjust", token: adminToken, body });

    const rec = await adjust({ user_id: userId, amount: 100, reason: "管理员代充", source: "recharge" });
    expect([rec.status, rec.body.data.balance_after]).toEqual([200, 100]);
    expect(rec.body.data.ref.startsWith("rc-")).toBe(true);

    // 余额 100 扣 30，全部从余额走
    await adjust({ user_id: userId, amount: -30, reason: "手工扣减" });
    expect((await call(meGet, { path: "/api/user/me", token: userToken })).body.data.balance).toBe(70);

    // 余额只剩 70，扣 100 时余额归零、剩下 30 占授信
    const deep = await adjust({ user_id: userId, amount: -100, reason: "扣到占授信" });
    expect(deep.body.data.balance_after).toBe(0);
    const me1 = await call(meGet, { path: "/api/user/me", token: userToken });
    expect([me1.body.data.balance, me1.body.data.credit_limit, me1.body.data.credit_available]).toEqual([0, 50, 20]);

    // 再充 50：先还掉 30 授信，剩下 20 才进余额
    const back = await adjust({ user_id: userId, amount: 50, reason: "再充一笔", source: "recharge" });
    expect(back.body.data.balance_after).toBe(20);
    const me2 = await call(meGet, { path: "/api/user/me", token: userToken });
    expect([me2.body.data.balance, me2.body.data.credit_available]).toEqual([20, 50]);

    // 管理员调账允许透支：扣 1000 会让授信欠款超过授信上限
    const over = await adjust({ user_id: userId, amount: -1000, reason: "透支" });
    expect(over.body.data.balance_after).toBe(0);
    const me3 = await call(meGet, { path: "/api/user/me", token: userToken });
    expect(me3.body.data.credit_available).toBeLessThan(0);
  });

  test("调账记录只收调账与代充，用户流水收全部", async () => {
    await resetUser();
    await call(adjustPost, { method: "POST", path: "/api/admin/balances/adjust", token: adminToken, body: { user_id: userId, amount: 100, reason: "代充", source: "recharge" } });
    await call(adjustPost, { method: "POST", path: "/api/admin/balances/adjust", token: adminToken, body: { user_id: userId, amount: -30, reason: "扣一次" } });
    // 混一条用量扣费进去，它不该出现在调账记录里
    await conn.query(
      "INSERT INTO credit_transactions (user_id, delta, balance_after, credit_used_after, source, created_at) VALUES (?, -1, 69, 0, 'usage', NOW(3))",
      [userId],
    );

    const logs = await call(logsGet, { path: `/api/admin/adjust-logs?user_id=${userId}`, token: adminToken });
    expect(logs.body.total).toBe(2);
    expect(logs.body.items[0].operator).toBe(adminName);
    expect(logs.body.items[0].user_name).toBe(userName);
    expect((await call(logsGet, { path: `/api/admin/adjust-logs?user_id=${userId}&direction=credit`, token: adminToken })).body.total).toBe(1);
    expect((await call(logsGet, { path: `/api/admin/adjust-logs?user_id=${userId}&direction=debit`, token: adminToken })).body.total).toBe(1);
    // 非法时间静默忽略，不是报错
    expect((await call(logsGet, { path: `/api/admin/adjust-logs?user_id=${userId}&start=不是时间`, token: adminToken })).body.total).toBe(2);

    const credits = await call(creditsGet, { path: "/api/user/credits", token: userToken });
    // 异常点：这个端点的 total 在 data 里，不在顶层
    expect([credits.body.total, credits.body.data.total]).toEqual([undefined, 3]);
    expect(credits.body.data.transactions.map((t: any) => t.source)).toEqual(["usage", "adjust", "recharge"]);
  });
});

describe("套餐与订阅", () => {
  test("列表带本机扩展字段，默认看不到已软删的", async () => {
    const listed = await call(plansGet, { path: "/api/admin/plans", token: adminToken });
    expect(listed.body.total).toBeGreaterThanOrEqual(5);
    const seed = listed.body.items.find((p: any) => p.name === "按量付费");
    expect(seed).toBeTruthy();
    for (const key of ["features", "recommended", "sort_order", "subscribers"]) {
      expect(seed).toHaveProperty(key);
    }
    expect(listed.body.items.map((p: any) => p.sort_order)).toEqual([...listed.body.items.map((p: any) => p.sort_order)].sort((a, b) => a - b));
  });

  test("新建套餐的参数校验与重名冲突", async () => {
    const post = (body: unknown) => call(plansPost, { method: "POST", path: "/api/admin/plans", token: adminToken, body });
    // 订阅制必须给订阅额度与周期
    expect((await post({ name: `t-e2e-缺订阅额度-${stamp}`, mode: "subscription", pricing_mode: "table" })).status).toBe(400);
    expect((await post({ name: `t-e2e-坏模式-${stamp}`, mode: "按月", pricing_mode: "table" })).status).toBe(400);
    expect((await post({ name: `t-e2e-坏定价-${stamp}`, mode: "subscription", pricing_mode: "按表", quota_amount: 1, quota_period_days: 1 })).status).toBe(400);
    expect((await post({ name: planName, mode: "pay_as_you_go", pricing_mode: "table" })).status).toBe(409);
  });

  test("模型价同一套餐下不能重复，删套餐会连模型价一起清掉", async () => {
    const addPrice = (body: unknown) =>
      call(pricePost, { method: "POST", path: `/api/admin/plans/${planId}/prices`, token: adminToken, params: { id: String(planId) }, body });

    const added = await addPrice({ model: "gpt-4o", input_per_million: 1.5, output_per_million: 6 });
    expect(added.status).toBe(200);
    expect((await addPrice({ model: "gpt-4o" })).status).toBe(409);
    const second = await addPrice({ model: "claude-sonnet-4", request_weight: 2 });

    const detail = await call(planGet, { path: `/api/admin/plans/${planId}`, token: adminToken, params: { id: String(planId) } });
    expect(detail.body.data.prices).toHaveLength(2);
    expect(detail.body.data.plan.name).toBe(planName);

    // 面板要看到模型条数与倍率区间
    const mine = await call(myPlansGet, { path: "/api/user/plans", token: userToken });
    const view = mine.body.data.plans.find((p: any) => p.id === planId);
    expect([view.model_count, view.weight_min, view.weight_max]).toEqual([2, 1, 2]);
    expect(mine.body.data.current).toBeNull();

    expect((await call(priceDel, { method: "DELETE", path: `/api/admin/plan_prices/${second.body.data.id}`, token: adminToken, params: { id: String(second.body.data.id) } })).status).toBe(200);

    // 建一个用完就删的套餐，验证软删会把价格清干净
    const throwaway = await call(plansPost, { method: "POST", path: "/api/admin/plans", token: adminToken, body: { name: `t-e2e-待删-${stamp}`, mode: "pay_as_you_go", pricing_mode: "table", price: 0 } });
    const throwawayId = throwaway.body.data.id;
    await call(pricePost, { method: "POST", path: `/api/admin/plans/${throwawayId}/prices`, token: adminToken, params: { id: String(throwawayId) }, body: { model: "gpt-4o-mini" } });
    expect((await call(planDel, { method: "DELETE", path: `/api/admin/plans/${throwawayId}`, token: adminToken, params: { id: String(throwawayId) } })).status).toBe(200);

    const after = await call(plansGet, { path: "/api/admin/plans?status=all", token: adminToken });
    expect(after.body.items.find((p: any) => p.id === throwawayId)?.status).toBe(0);
    expect(after.body.items.find((p: any) => p.id === planId)).toBeTruthy();
    expect((await call(plansGet, { path: "/api/admin/plans", token: adminToken })).body.items.find((p: any) => p.id === throwawayId)).toBeUndefined();
    const [prices] = (await conn.query("SELECT COUNT(*) n FROM plan_prices WHERE plan_id = ?", [throwawayId])) as any[];
    expect(prices[0].n).toBe(0);
    await conn.query("DELETE FROM plans WHERE id = ?", [throwawayId]);
  });

  test("余额不足回 402，够就扣钱写订阅", async () => {
    await resetUser();
    const subscribe = () => call(subscribePost, { method: "POST", path: `/api/user/plans/${planId}/subscribe`, token: userToken, params: { id: String(planId) } });

    // 余额 0、授信 50，但把授信也收掉，可用（余额 + 授信）就是 0
    await call(adminUserPut, { method: "PUT", path: `/api/admin/users/${userId}`, token: adminToken, params: { id: String(userId) }, body: { credit_limit: 0 } });
    const blocked = await subscribe();
    expect(blocked.status).toBe(402);
    expect(String(blocked.body.error)).toContain("余额不足");

    // 恢复授信并充值，这次够付 10 元
    await call(adminUserPut, { method: "PUT", path: `/api/admin/users/${userId}`, token: adminToken, params: { id: String(userId) }, body: { credit_limit: 50 } });
    await call(adjustPost, { method: "POST", path: "/api/admin/balances/adjust", token: adminToken, body: { user_id: userId, amount: 100, reason: "订阅前充值", source: "recharge" } });
    expect((await subscribe()).status).toBe(200);

    const [u] = (await conn.query("SELECT balance, credit_used, plan_id FROM users WHERE id = ?", [userId])) as any[];
    expect([u[0].balance, u[0].credit_used, u[0].plan_id]).toEqual(["90.00000000", "0.00000000", planId]);

    const [subs] = (await conn.query("SELECT plan_id, amount, quota_limit, quota_used, quota_kind, status, DATEDIFF(period_end, period_start) days FROM subscriptions WHERE user_id = ?", [userId])) as any[];
    expect(subs).toHaveLength(1);
    expect([subs[0].plan_id, subs[0].amount, subs[0].quota_limit, subs[0].quota_used, subs[0].quota_kind, subs[0].status, subs[0].days]).toEqual([planId, "10.00000000", "10.00000000", "0.00000000", "money", "active", 30]);

    const [tx] = (await conn.query("SELECT delta, ref_id, balance_after, source FROM credit_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 1", [userId])) as any[];
    expect([tx[0].delta, tx[0].ref_id, tx[0].balance_after, tx[0].source]).toEqual(["-10.00000000", `plan-${planId}`, "90.00000000", "subscription"]);
  });

  test("续费再扣一次、多一行，激活统计与概览跟着变", async () => {
    const subscribe = () => call(subscribePost, { method: "POST", path: `/api/user/plans/${planId}/subscribe`, token: userToken, params: { id: String(planId) } });
    expect((await subscribe()).status).toBe(200);

    const [u] = (await conn.query("SELECT balance FROM users WHERE id = ?", [userId])) as any[];
    const [subs] = (await conn.query("SELECT COUNT(*) n FROM subscriptions WHERE user_id = ?", [userId])) as any[];
    expect([u[0].balance, subs[0].n]).toEqual(["80.00000000", 2]);

    const mine = await call(myPlansGet, { path: "/api/user/plans", token: userToken });
    expect([mine.body.data.current.plan.id, mine.body.data.current.quota_limit, mine.body.data.default_plan_id]).toEqual([planId, 10, planId]);

    const acts = await call(activationsGet, { path: `/api/admin/plan-activations?user_id=${userId}`, token: adminToken });
    const row = acts.body.items[0];
    expect([row.user_id, row.total_spend, row.activation_count, row.plan_name, row.quota_limit]).toEqual([userId, 20, 2, planName, 10]);

    const summary = await call(summaryGet, { path: "/api/admin/plan-activations/summary", token: adminToken });
    expect(summary.body.data.subscribers).toBeGreaterThanOrEqual(1);
    expect(summary.body.data.month_revenue).toBeGreaterThanOrEqual(20);
    // 周期是 30 天，不该算进「七天内到期」
    expect(summary.body.data.expiring_7d).toBe(0);

    const history = await call(historyGet, { path: `/api/admin/plan-activations/${userId}/history`, token: adminToken, params: { user_id: String(userId) } });
    expect(history.body.items).toHaveLength(2);
    // 订阅流水 delta 为负，这里回正数
    expect([history.body.items[0].amount, history.body.items[0].plan_name]).toEqual([10, planName]);
  });

  test("过期订阅筛得出来", async () => {
    await conn.query("UPDATE subscriptions SET period_end = DATE_SUB(NOW(3), INTERVAL 1 DAY) WHERE user_id = ?", [userId]);
    const expired = await call(activationsGet, { path: `/api/admin/plan-activations?user_id=${userId}&expire=expired`, token: adminToken });
    expect(expired.body.items).toHaveLength(1);
    const soon = await call(activationsGet, { path: `/api/admin/plan-activations?user_id=${userId}&expire=7d`, token: adminToken });
    expect(soon.body.items).toHaveLength(0);
    // 坏值静默忽略，不报错
    const bogus = await call(activationsGet, { path: `/api/admin/plan-activations?user_id=${userId}&expire=明天`, token: adminToken });
    expect(bogus.status).toBe(200);
  });
});

describe("客户端密钥校验端点", () => {
  /** 建一个用完就删的测试套餐 */
  async function createPlan(name: string, body: Record<string, unknown>) {
    const res = await call(plansPost, { method: "POST", path: "/api/admin/plans", token: adminToken, body: { name, ...body } });
    if (res.status !== 200) throw new Error(`建测试套餐失败：${JSON.stringify(res.body)}`);
    return res.body.data.id as number;
  }

  /** 签一把客户端密钥，返回明文与 id */
  async function issueKey(name: string) {
    const res = await call(myKeysPost, { method: "POST", path: "/api/user/api_keys", token: userToken, body: { name } });
    if (res.status !== 200) throw new Error(`签客户端密钥失败：${JSON.stringify(res.body)}`);
    return { plain: res.body.data.key as string, id: res.body.data.id as number };
  }

  const lookup = (key: string, headers = recordsSecretHeaders) =>
    call(apiKeyLookupPost, { method: "POST", path: "/api/internal/api-key", headers, body: { key } });

  test("有效密钥回身份、限流白名单与计价口径：订阅优先，其次绑定", async () => {
    await resetUser();

    const tablePlan = await createPlan(`t-e2e-内核表-${stamp}`, {
      mode: "subscription",
      pricing_mode: "table",
      quota_kind: "money",
      quota_amount: 10,
      quota_period_days: 30,
      price: 1,
    });
    const markupPlan = await createPlan(`t-e2e-内核倍率-${stamp}`, {
      mode: "subscription",
      pricing_mode: "markup",
      markup_multiplier: 1.15,
      quota_kind: "money",
      quota_amount: 10,
      quota_period_days: 30,
      price: 1,
    });

    try {
      const pricePath = `/api/admin/plans/${tablePlan}/prices`;
      const addPrice = (body: unknown) =>
        call(pricePost, { method: "POST", path: pricePath, token: adminToken, params: { id: String(tablePlan) }, body });
      expect((await addPrice({ model: "gpt-4o", input_per_million: 1.5, output_per_million: 6 })).status).toBe(200);
      expect((await addPrice({ model: "claude-sonnet-4", request_weight: 2 })).status).toBe(200);

      // 先绑按表那档，再订阅倍率那档，然后把绑定改回按表：两条路分叉，验证订阅优先
      const userPath = `/api/admin/users/${userId}`;
      const bind = (plan_id: number | null) =>
        call(adminUserPut, { method: "PUT", path: userPath, token: adminToken, params: { id: String(userId) }, body: { plan_id } });
      expect((await bind(tablePlan)).status).toBe(200);
      await call(adjustPost, { method: "POST", path: "/api/admin/balances/adjust", token: adminToken, body: { user_id: userId, amount: 100, reason: "订阅前充值", source: "recharge" } });
      expect((await call(subscribePost, { method: "POST", path: `/api/user/plans/${markupPlan}/subscribe`, token: userToken, params: { id: String(markupPlan) } })).status).toBe(200);
      expect((await bind(tablePlan)).status).toBe(200);

      const key = await issueKey("内核校验用");
      await conn.query("UPDATE api_keys SET model_whitelist = ?, rate_limit_per_min = 60 WHERE id = ?", [JSON.stringify(["gpt-4o"]), key.id]);

      const bySubscription = await lookup(key.plain);
      expect(bySubscription.status).toBe(200);
      expect(bySubscription.body.ok).toBe(true);
      const data = bySubscription.body.data;
      expect([data.user_id, data.api_key_id]).toEqual([userId, key.id]);
      expect([data.model_whitelist, data.rate_limit_per_min, data.expires_at]).toEqual([["gpt-4o"], 60, null]);
      // 有生效订阅就以订阅为准，绑的是另一档也不看
      expect([data.pricing.plan_id, data.pricing.pricing_mode, data.pricing.markup_multiplier, data.pricing.prices]).toEqual([markupPlan, "markup", 1.15, []]);

      // 订阅取消后落到绑定的按表那档，模型价全给出来
      await conn.query("UPDATE subscriptions SET status = 'cancelled' WHERE user_id = ?", [userId]);
      const byBinding = (await lookup(key.plain)).body.data;
      expect([byBinding.pricing.plan_id, byBinding.pricing.pricing_mode, byBinding.pricing.prices.length]).toEqual([tablePlan, "table", 2]);
      expect(byBinding.pricing.prices.find((p: any) => p.model === "gpt-4o")).toEqual({
        model: "gpt-4o",
        cost_mode: "token",
        input_per_million: 1.5,
        output_per_million: 6,
        cache_read_per_million: 0,
        cache_write_per_million: 0,
        per_request: 0,
        request_weight: 1,
      });

      // 解绑又没有订阅：计价三项为 null、价表为空，内核据此只推用量不算钱
      expect((await bind(null)).status).toBe(200);
      const none = (await lookup(key.plain)).body.data;
      expect([none.pricing.plan_id, none.pricing.pricing_mode, none.pricing.markup_multiplier, none.pricing.prices]).toEqual([null, null, null, []]);
    } finally {
      await conn.query("DELETE FROM subscriptions WHERE plan_id IN (?, ?)", [tablePlan, markupPlan]);
      await conn.query("DELETE FROM plan_prices WHERE plan_id IN (?, ?)", [tablePlan, markupPlan]);
      await conn.query("DELETE FROM plans WHERE id IN (?, ?)", [tablePlan, markupPlan]);
      await resetUser();
    }
  });

  test("未知、停用、过期与账号停用分开回 404 / 403 / 410", async () => {
    await resetUser();

    expect((await lookup(`sk-${"0".repeat(64)}`)).status).toBe(404);

    const disabledKey = await issueKey("停用");
    await conn.query("UPDATE api_keys SET status = 0 WHERE id = ?", [disabledKey.id]);
    expect((await lookup(disabledKey.plain)).status).toBe(403);

    const expiredKey = await issueKey("过期");
    await conn.query("UPDATE api_keys SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 DAY) WHERE id = ?", [expiredKey.id]);
    expect((await lookup(expiredKey.plain)).status).toBe(410);

    const userDisabledKey = await issueKey("账号停用");
    await conn.query("UPDATE users SET status = 0 WHERE id = ?", [userId]);
    expect((await lookup(userDisabledKey.plain)).status).toBe(403);
    await conn.query("UPDATE users SET status = 1 WHERE id = ?", [userId]);

    // 参数与鉴权
    const post = (body: unknown, headers = recordsSecretHeaders) =>
      call(apiKeyLookupPost, { method: "POST", path: "/api/internal/api-key", headers, body });
    expect((await post({})).status).toBe(400);
    expect((await post({ key: 42 })).status).toBe(400);
    expect((await post({ key: "x" }, {})).status).toBe(401);
    expect((await post({ key: userDisabledKey.plain }, rechargeSecretHeaders)).status).toBe(403);

    await resetUser();
  });

  test("两把共享密钥不通用", async () => {
    // 摄入端点只认 RECORDS 那把
    const ingest = (headers: Record<string, string>) =>
      call(recordsIngestPost, { method: "POST", path: "/api/internal/records", headers, body: { records: [] } });
    expect((await ingest(rechargeSecretHeaders)).status).toBe(403);
    expect((await ingest(recordsSecretHeaders)).status).toBe(200);

    // 充值回调只认 RECHARGE 那把
    const callback = (headers: Record<string, string>) =>
      call(rechargeCallbackPost, {
        method: "POST",
        path: "/api/internal/recharge-callback",
        headers,
        body: { order_no: "rc-does-not-exist", status: "paid" },
      });
    expect((await callback(recordsSecretHeaders)).status).toBe(403);
    // 用对了共享密钥就过了鉴权，走到「单号不存在」
    expect((await callback(rechargeSecretHeaders)).status).toBe(404);
  });

  test("客户端密钥查询只走 sha256，路径上没有 bcrypt", () => {
    // bcrypt 是登录口令那条路用的；转发链路每次请求都会走这里，必须靠 key_hash 上的
    // 唯一索引一次命中，不能对候选行逐条 compare。注释里可以提 bcrypt，代码里不行。
    const source = fs.readFileSync("src/lib/api-key-lookup.ts", "utf-8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/bcrypt/i);
    expect(code).toContain("hashApiKey");
    expect(code).toContain("apiKeys.keyHash");
  });
});

describe("摄入时一并记账", () => {
  const ingest = (body: unknown) =>
    call(recordsIngestPost, { method: "POST", path: "/api/internal/records", headers: recordsSecretHeaders, body });

  const adjust = (amount: number, reason: string) =>
    call(adjustPost, {
      method: "POST",
      path: "/api/admin/balances/adjust",
      token: adminToken,
      body: { user_id: userId, amount, reason, source: "recharge" },
    });

  const subscribe = () =>
    call(subscribePost, {
      method: "POST",
      path: `/api/user/plans/${planId}/subscribe`,
      token: userToken,
      params: { id: String(planId) },
    });

  /** 每个用例自己造 request_id，跑完 afterAll 清掉，重复跑不会撞唯一键 */
  let seq = 0;
  const requestId = () => `t-e2e-ingest-${stamp}-${++seq}`;
  const billingRow = (id: string, revenue: number, extra: Record<string, unknown> = {}) => ({
    request_id: id,
    user_id: userId,
    model: "gpt-4o",
    revenue_amount: revenue,
    total_tokens: 10,
    ...extra,
  });

  async function balanceOf() {
    const [rows] = (await conn.query("SELECT balance, credit_used, credit_limit FROM users WHERE id = ?", [userId])) as any[];
    return {
      balance: Number(rows[0].balance),
      creditUsed: Number(rows[0].credit_used),
      creditLimit: Number(rows[0].credit_limit),
    };
  }

  async function quotaUsed() {
    const [rows] = (await conn.query(
      "SELECT quota_used FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY period_end DESC LIMIT 1",
      [userId],
    )) as any[];
    return rows[0] ? Number(rows[0].quota_used) : null;
  }

  async function usageTx(refId: string) {
    const [rows] = (await conn.query(
      "SELECT delta, source, ledger, ref_id, balance_after FROM credit_transactions WHERE ref_id = ? ORDER BY id",
      [refId],
    )) as any[];
    return rows;
  }

  async function billingLedger(refId: string) {
    const [rows] = (await conn.query("SELECT ledger FROM billing_records WHERE request_id = ?", [refId])) as any[];
    return rows[0]?.ledger ?? null;
  }

  test("没有订阅时按 revenue_amount 扣余额，并写一条 usage 流水", async () => {
    await resetUser();
    await adjust(100, "摄入前充值");

    const rid = requestId();
    const res = await ingest({
      records: [{ request_id: rid, user_id: userId, model: "gpt-4o" }],
      billing: [billingRow(rid, 0.5)],
    });
    expect(res.status).toBe(200);
    expect([res.body.ok, res.body.inserted, res.body.skipped, res.body.invalid]).toEqual([true, 2, 0, 0]);

    const tx = await usageTx(rid);
    expect(tx).toHaveLength(1);
    expect([tx[0].source, tx[0].ledger, tx[0].ref_id, Number(tx[0].delta)]).toEqual(["usage", "balance", rid, -0.5]);
    expect((await balanceOf()).balance).toBe(99.5);
    expect(await billingLedger(rid)).toBe("balance");
  });

  test("同一批重复提交只扣一次，批量内部的重复也去重", async () => {
    await resetUser();
    await adjust(100, "摄入前充值");

    const rid = requestId();
    const batch = { records: [{ request_id: rid, user_id: userId }], billing: [billingRow(rid, 2)] };

    const first = await ingest(batch);
    expect([first.body.inserted, first.body.skipped]).toEqual([2, 0]);
    // 转发侧重发整批：插行全跳，钱也不能再扣
    const second = await ingest(batch);
    expect([second.body.inserted, second.body.skipped]).toEqual([0, 2]);
    expect((await balanceOf()).balance).toBe(98);
    expect(await usageTx(rid)).toHaveLength(1);

    // 同一批里塞两行同一个 request_id，只留第一条
    const dup = requestId();
    const third = await ingest({ billing: [billingRow(dup, 3), billingRow(dup, 3)] });
    expect([third.body.inserted, third.body.skipped]).toEqual([1, 1]);
    expect((await balanceOf()).balance).toBe(95);
    expect(await usageTx(dup)).toHaveLength(1);
  });

  test("有订阅时先吃订阅额度，订阅额度满了才整笔走余额", async () => {
    await resetUser();
    await adjust(100, "摄入前充值");
    // 订阅扣 10 元，余额 90，订阅额度 10，quota_used 从 0 起
    expect((await subscribe()).status).toBe(200);
    expect(await quotaUsed()).toBe(0);

    const a = requestId();
    const b = requestId();
    const c = requestId();
    const res = await ingest({ billing: [billingRow(a, 4), billingRow(b, 6), billingRow(c, 1)] });
    expect(res.body.inserted).toBe(3);

    // 前两笔吃订阅额度，加起来正好 10；第三笔订阅额度不够，整笔走余额
    expect([await billingLedger(a), await billingLedger(b), await billingLedger(c)]).toEqual(["quota", "quota", "balance"]);
    expect(await quotaUsed()).toBe(10);

    // 走订阅额度的两笔不动余额，也不写 credit_transactions
    expect(await usageTx(a)).toHaveLength(0);
    expect(await usageTx(b)).toHaveLength(0);

    const tx = await usageTx(c);
    expect([tx.length, tx[0].ledger, Number(tx[0].delta)]).toEqual([1, "balance", -1]);
    expect((await balanceOf()).balance).toBe(89);
  });

  test("余额与授信都不够时按透支处理，delta 与 revenue_amount 一一对应", async () => {
    await resetUser();
    // 余额 0，授信也收掉，可用（余额 + 授信）就是 0
    await call(adminUserPut, {
      method: "PUT",
      path: `/api/admin/users/${userId}`,
      token: adminToken,
      params: { id: String(userId) },
      body: { credit_limit: 0 },
    });

    const rid = requestId();
    const res = await ingest({ billing: [billingRow(rid, 5)] });
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);

    const tx = await usageTx(rid);
    expect([tx.length, Number(tx[0].delta), Number(tx[0].balance_after), tx[0].ledger]).toEqual([1, -5, 0, "balance"]);
    const u = await balanceOf();
    // 余额扣到 0 为止，剩下 5 元占授信，可用（余额 + 授信）成负数
    expect([u.balance, u.creditUsed]).toEqual([0, 5]);
    expect(u.creditLimit - u.creditUsed).toBe(-5);
    expect(await billingLedger(rid)).toBe("balance");
  });

  test("billing 行的用户不存在时照常入库，只是不扣费", async () => {
    const rid = requestId();
    const res = await ingest({ billing: [billingRow(rid, 1, { user_id: 99999999 })] });
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    expect(await usageTx(rid)).toHaveLength(0);
    expect(await billingLedger(rid)).toBeNull();
  });
});
