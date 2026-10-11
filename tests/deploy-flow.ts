/**
 * 部署后的真实 HTTP 全流程验证。
 *
 * 与 tests/api.test.ts 的区别：那份直接调 handler，这份打的是跑起来的生产构建
 * （node .output/server/index.mjs），走真实 HTTP、真实登录、真实 cookie。
 * 每个请求都经过 nitro 的中间件、SSR 与数据库。
 *
 * 用法（先在另一个终端把服务起起来）：
 *
 *   PORT=6789 node .output/server/index.mjs
 *   bun tests/deploy-flow.ts
 *
 * 会自己建两个测试账号（管理员与被管理的业务用户），跑完删干净。
 */
import mysql from "mysql2/promise";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:6789";
const stamp = Date.now();
const adminEmail = `e2e-admin-${stamp}@example.com`;
const userName = `e2e-user-${stamp}`;
const userEmail = `${userName}@example.com`;
const password = "e2e-Password-123";
const planName = `e2e-套餐-${stamp}`;

const conn = await mysql.createConnection(
  process.env.DATABASE_URL ?? "mysql://tokenmp:tokenmp-dev@127.0.0.1:3307/tokenmp",
);

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    return;
  }
  fail++;
  const line = `${label}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 220)}`}`;
  failures.push(line);
  console.log(`  ✗ ${line}`);
}

function is(label: string, actual: unknown, expected: unknown) {
  check(`${label}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`, JSON.stringify(actual) === JSON.stringify(expected));
}

/** 带 cookie 的请求客户端。会话靠 set-cookie 里的 tokenmp_session，手动接管，不看 cookie jar */
function client() {
  let cookie = "";
  async function req(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(";")[0];
      if (pair.startsWith("tokenmp_session=")) cookie = pair;
    }
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* HTML */
    }
    return { status: res.status, body: parsed, headers: res.headers, raw: text };
  }
  return {
    req,
    GET: (p: string) => req("GET", p),
    POST: (p: string, b?: unknown) => req("POST", p, b),
    PUT: (p: string, b?: unknown) => req("PUT", p, b),
    DELETE: (p: string) => req("DELETE", p),
    hasSession: () => cookie !== "",
  };
}

const admin = client();
const user = client();
const anon = client();
let adminId = 0;
let userId = 0;
let planId = 0;

try {
  console.log("\n【1】注册与登录（真实接口，不是签 token）");
  const reg = await admin.POST("/api/auth/register", { email: adminEmail, password, name: `e2e-admin-${stamp}` });
  // 本机注册回 201，线上回 200，这是 openapi 里记着的一处有意差异
  is("注册管理员账号", reg.status, 201);
  adminId = reg.body?.user?.id;
  check("注册返回了用户 id", typeof adminId === "number", reg.body);
  check("注册顺带就带上了会话 cookie", admin.hasSession());

  // 普通注册建出来是 user，这里按业务上「授予管理员」的效果改一下角色。
  // 线上没有「提权」接口，所以只能从库里改；这一步不是被测对象，只是准备条件。
  await conn.query("UPDATE users SET role = 'admin' WHERE id = ?", [adminId]);

  const login = await admin.POST("/api/auth/login", { email: adminEmail, password });
  is("管理员登录", login.status, 200);
  is("登录返回的角色", login.body?.user?.role, "admin");

  is("匿名看 /api/auth/me", (await anon.GET("/api/auth/me")).status, 401);
  const me = await admin.GET("/api/auth/me");
  is("管理员看 /api/auth/me", me.status, 200);

  console.log("\n【2】SSR 页面在有会话时的表现");
  const dash = await admin.GET("/dashboard");
  is("登录后访问 /dashboard", dash.status, 200);
  check("/dashboard 返回的是 HTML", dash.raw.includes("<html"), dash.raw.slice(0, 80));
  const dashAnon = await anon.GET("/dashboard");
  is("未登录访问 /dashboard 被重定向", [dashAnon.status, dashAnon.headers.get("location")], [302, "/"]);

  console.log("\n【3】管理员建业务用户");
  const created = await admin.POST("/api/admin/users", {
    name: userName,
    email: userEmail,
    password,
    credit_limit: 50,
  });
  is("新建用户", created.status, 200);
  userId = created.body?.data?.id;
  check("拿到用户 id", typeof userId === "number" && userId > 0, created.body);

  const listed = await admin.GET(`/api/admin/users?keyword=${userName}`);
  is("按用户名搜到", listed.body?.total, 1);
  is("列表里的余额", listed.body?.items?.[0]?.balance, 0);

  console.log("\n【4】管理员给用户设预算、代充、签发密钥");
  const budget = await admin.PUT(`/api/admin/users/${userId}/budget`, { enabled: true, amount: 200, period: "month" });
  is("设预算", [budget.status, budget.body?.data?.amount, budget.body?.data?.period], [200, 200, "month"]);

  const recharge = await admin.POST("/api/admin/balances/adjust", {
    user_id: userId,
    amount: 300,
    reason: "管理员代充",
    source: "recharge",
  });
  is("代充 300", [recharge.status, recharge.body?.data?.balance_after], [200, 300]);
  check("代充的 ref 带 rc 前缀", String(recharge.body?.data?.ref).startsWith("rc-"), recharge.body?.data?.ref);

  const key = await admin.POST(`/api/admin/users/${userId}/api_keys`, { name: "管理员代签" });
  is("管理员代签密钥", key.status, 200);
  check("明文只回这一次", typeof key.body?.data?.key === "string" && key.body.data.key.startsWith("sk-"));
  const keyId = key.body?.data?.id;
  const keyList = await admin.GET(`/api/admin/users/${userId}/api_keys`);
  check("列表里拿不回明文", keyList.body?.items?.[0]?.key === undefined);
  await admin.DELETE(`/api/admin/api_keys/${keyId}`);

  console.log("\n【5】管理员建套餐并定价");
  const plan = await admin.POST("/api/admin/plans", {
    name: planName,
    mode: "subscription",
    pricing_mode: "table",
    quota_kind: "money",
    quota_amount: 20,
    quota_period_days: 30,
    price: 20,
    currency: "CNY",
    features: ["每月 20 元额度", "全量模型"],
    recommended: true,
  });
  is("新建套餐", plan.status, 200);
  planId = plan.body?.data?.id;
  const prices = await admin.POST(`/api/admin/plans/${planId}/prices`, { model: "gpt-4o", input_per_million: 2, output_per_million: 8 });
  is("加模型价", prices.status, 200);

  console.log("\n【6】用户登录并订阅套餐");
  const userLogin = await user.POST("/api/auth/login", { email: userEmail, password });
  is("用户登录", userLogin.status, 200);
  is("用户看自己的账号", (await user.GET("/api/user/me")).status, 200);
  const before = await user.GET("/api/user/me");
  is("订阅前余额", before.body?.data?.balance, 300);
  is("订阅前预算", [before.body?.data?.budget?.amount, before.body?.data?.budget?.used], [200, 0]);

  const catalog = await user.GET("/api/user/plans");
  check("套餐列表里有刚建的套餐", catalog.body?.data?.plans?.some((p: any) => p.id === planId), catalog.body?.data?.plans?.length);
  is("订阅前没有当前订阅", catalog.body?.data?.current, null);

  const sub = await user.POST(`/api/user/plans/${planId}/subscribe`);
  is("订阅套餐", sub.status, 200);

  const after = await user.GET("/api/user/me");
  is("订阅后余额", after.body?.data?.balance, 280);
  is("订阅后 plan_id", after.body?.data?.plan_id, planId);
  const current = await user.GET("/api/user/plans");
  is("当前订阅的额度", [current.body?.data?.current?.quota_limit, current.body?.data?.current?.quota_used], [20, 0]);

  console.log("\n【7】用户自助签密钥与查流水");
  const myKey = await user.POST("/api/user/api_keys", { name: "我自己签的" });
  is("用户自助签发", myKey.status, 200);
  const credits = await user.GET("/api/user/credits");
  is("流水里能看到订阅扣款", credits.body?.data?.transactions?.[0]?.source, "subscription");
  is("流水 total 在 data 里", [credits.body?.total, credits.body?.data?.total], [undefined, 2]);

  console.log("\n【8】管理员看激活统计与调账记录");
  const acts = await admin.GET(`/api/admin/plan-activations?user_id=${userId}`);
  is("激活聚合", [acts.body?.items?.[0]?.total_spend, acts.body?.items?.[0]?.activation_count], [20, 1]);
  is("激活行里的套餐名", acts.body?.items?.[0]?.plan_name, planName);
  const summary = await admin.GET("/api/admin/plan-activations/summary");
  check("概览里有订阅数", Number(summary.body?.data?.subscribers) >= 1, summary.body?.data);
  const logs = await admin.GET(`/api/admin/adjust-logs?user_id=${userId}`);
  is("调账记录 1 条", logs.body?.total, 1);
  is("记录里的操作人", logs.body?.items?.[0]?.operator, `e2e-admin-${stamp}`);

  console.log("\n【9】管理员禁用用户，会话是否立即失效");
  is("禁用前用户还能用", (await user.GET("/api/user/me")).status, 200);
  const disabled = await admin.DELETE(`/api/admin/users/${userId}`);
  is("禁用用户", disabled.status, 200);
  const [row] = (await conn.query("SELECT status, balance FROM users WHERE id = ?", [userId])) as any[];
  is("库里变成停用且余额保留", [row[0].status, row[0].balance], [0, "280.00000000"]);
  is("禁用后用户会话立刻失效", (await user.GET("/api/user/me")).status, 401);
  is("禁用后登录被拒", (await user.POST("/api/auth/login", { email: userEmail, password })).status, 403);
} finally {
  console.log("\n【10】清理");
  // 只删本次命名的账号。上一次因注册失败没拿到 id，兜底按邮箱前缀匹配，
  // 前缀里带 stamp，不会误伤别人的测试数据
  await conn.query("DELETE FROM credit_transactions WHERE user_id IN (?, ?)", [userId, adminId]);
  await conn.query("DELETE FROM subscriptions WHERE user_id IN (?, ?) OR plan_id = ?", [userId, adminId, planId]);
  await conn.query("DELETE FROM api_keys WHERE user_id IN (?, ?)", [userId, adminId]);
  await conn.query("DELETE FROM user_budgets WHERE user_id IN (?, ?)", [userId, adminId]);
  if (planId) await conn.query("DELETE FROM plan_prices WHERE plan_id = ?", [planId]);
  await conn.query("DELETE FROM plans WHERE name = ?", [planName]);
  const [stale] = (await conn.query("SELECT id FROM users WHERE email LIKE ? OR email LIKE ?", [
    `e2e-admin-${stamp}%`,
    `e2e-user-${stamp}%`,
  ])) as any[];
  const staleIds = (stale as any[]).map(r => r.id);
  if (staleIds.length) {
    await conn.query("DELETE FROM credit_transactions WHERE user_id IN (?)", [staleIds]);
    await conn.query("DELETE FROM subscriptions WHERE user_id IN (?)", [staleIds]);
    await conn.query("DELETE FROM api_keys WHERE user_id IN (?)", [staleIds]);
    await conn.query("DELETE FROM user_budgets WHERE user_id IN (?)", [staleIds]);
    await conn.query("DELETE FROM users WHERE id IN (?)", [staleIds]);
  }

  const [left] = (await conn.query("SELECT COUNT(*) n FROM users WHERE email LIKE ?", [`e2e-%-${stamp}@%`])) as any[];
  check("本次的测试账号已清理", left[0].n === 0, left[0]);
  await conn.end();

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  if (failures.length) {
    console.log("\n失败明细：");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}
