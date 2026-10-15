/**
 * 页面接线的浏览器验证。
 *
 * 判断一个页面「有没有真的接后端」，最稳的办法不是断言 DOM 结构，而是：
 * 先用接口造一条带唯一标记的数据，再用浏览器打开那一页，看标记有没有出现。
 * 出现了就说明页面读的是数据库；同时断言那些写死的模拟数据不再出现。
 *
 * 用法（先起服务）：
 *
 *   PORT=6789 node --env-file=.env .output/server/index.mjs
 *   bun tests/ui-pages.ts
 */
import mysql from "mysql2/promise";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:6789";
const stamp = Date.now();
const adminEmail = `pages-admin-${stamp}@example.com`;
const password = "pages-Password-123";

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
  const line = `${label}${detail === undefined ? "" : ` → ${String(detail).slice(0, 200)}`}`;
  failures.push(line);
  console.log(`  ✗ ${line}`);
}

/** 写死的模拟数据里才有的字样。接上后端之后这些不该再出现在页面上 */
const MOCK_SENTINELS: Record<string, string[]> = {
  "/dashboard/users": ["lin.zy@example.com", "wang.qi@example.com"],
  "/dashboard/balances": ["lin@example.com", "wang@example.com"],
  "/dashboard/plans": ["1.5 亿 Token", "$1,990"],
  "/panel/plans": ["林知远"],
  "/panel/me": ["林知远", "lin.zy@example.com"],
  "/panel/credits": ["林知远"],
  "/panel/keys": ["林知远"],
};

let adminId = 0;
let markerUserId = 0;
let markerPlanId = 0;
let markerKeyPrefix = "";
const markerUser = `pages-标记用户-${stamp}`;
const markerPlan = `pages-标记套餐-${stamp}`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const consoleErrors: string[] = [];
page.on("console", msg => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
});

/** 以管理员身份登录，返回带会话的页面 */
async function loginAsAdmin() {
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password, name: `pages-admin-${stamp}` }),
  });
  const body = (await reg.json()) as { user: { id: number } };
  adminId = body.user.id;
  await conn.query("UPDATE users SET role = 'admin' WHERE id = ?", [adminId]);

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("#email").fill(adminEmail);
  await page.locator("#password").fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(url => url.pathname.startsWith("/dashboard"), { timeout: 15000 });
}

async function api(path: string, method: string, payload?: unknown) {
  // 浏览器上下文里带着会话 cookie，直接用页面自己的 fetch，省得再拼 cookie
  return page.evaluate(
    async ([p, m, b]) => {
      const res = await fetch(p as string, {
        method: m as string,
        headers: b === null ? undefined : { "content-type": "application/json" },
        body: b === null ? undefined : JSON.stringify(b),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    [path, method, payload === undefined ? null : payload] as const,
  );
}

/** 打开一页，返回可见文本 */
async function visit(path: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900); // 等 createClientResource 从浏览器发出去的那次请求回来
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

try {
  console.log("\n【准备】建标记数据");
  await loginAsAdmin();
  check("登录成功", page.url().includes("/dashboard"), page.url());

  const createdUser = await api("/api/admin/users", "POST", {
    name: markerUser,
    email: `${markerUser}@example.com`,
  });
  check("建标记用户", createdUser.status === 200, createdUser);
  markerUserId = (createdUser.body as any)?.data?.id;

  const createdPlan = await api("/api/admin/plans", "POST", {
    name: markerPlan,
    mode: "pay_as_you_go",
    pricing_mode: "table",
    price: 7,
    currency: "CNY",
  });
  check("建标记套餐", createdPlan.status === 200, createdPlan);
  markerPlanId = (createdPlan.body as any)?.data?.id;

  const keyed = await api("/api/user/api_keys", "POST", { name: "标记密钥" });
  check("签标记密钥", keyed.status === 200, keyed);
  markerKeyPrefix = (keyed.body as any)?.data?.key_prefix ?? "";

  console.log("\n【一】接上后端的页面：标记数据要出现，模拟数据要消失");
  const routes = [
    "/dashboard/users",
    "/dashboard/balances",
    "/dashboard/plans",
    "/dashboard/api-keys",
    "/panel/plans",
    "/panel/me",
    "/panel/credits",
    "/panel/keys",
  ];

  for (const route of routes) {
    const text = await visit(route);
    check(`${route} 打开后不是空白`, text.length > 40, text.slice(0, 80));
    // 这一条是为 /panel/me 那个 404 加的：路由被静默丢掉时页面会渲染成 404，
    // 而 404 页的字数也超过 40，光判「不是空白」抓不到
    check(`${route} 不是 404 页`, !text.includes("页面不存在"), text.slice(0, 120));
    for (const sentinel of MOCK_SENTINELS[route] ?? []) {
      check(`${route} 不再出现写死的「${sentinel}」`, !text.includes(sentinel));
    }
  }

  const usersPage = await visit("/dashboard/users");
  check("/dashboard/users 显示标记用户", usersPage.includes(markerUser), usersPage.slice(0, 300));

  const balancesPage = await visit("/dashboard/balances");
  check("/dashboard/balances 显示标记用户", balancesPage.includes(markerUser), balancesPage.slice(0, 300));

  const plansPage = await visit("/dashboard/plans");
  check("/dashboard/plans 显示标记套餐", plansPage.includes(markerPlan), plansPage.slice(0, 300));

  const panelPlans = await visit("/panel/plans");
  check("/panel/plans 显示库里的种子套餐", panelPlans.includes("按量付费"), panelPlans.slice(0, 300));

  const panelMe = await visit("/panel/me");
  check("/panel/me 显示当前登录账号", panelMe.includes(adminEmail), panelMe.slice(0, 300));

  const panelKeys = await visit("/panel/keys");
  check(
    "/panel/keys 显示刚签的密钥前缀",
    markerKeyPrefix ? panelKeys.includes(markerKeyPrefix) : false,
    `${markerKeyPrefix} / ${panelKeys.slice(0, 300)}`,
  );

  console.log("\n【二】新增页面能打开");
  for (const route of [
    "/dashboard/notifications",
    "/dashboard/recharge",
    "/panel/request-records",
    "/panel/billing",
    "/dashboard/billing",
    "/dashboard/request-records",
  ]) {
    const text = await visit(route);
    check(`${route} 打开后不是空白`, text.length > 40, text.slice(0, 80));
    check(`${route} 不是 404 页`, !text.includes("页面不存在"), text.slice(0, 120));
  }

  console.log("\n【三】控制台没报错");
  const noisy = consoleErrors.filter(e => !/favicon|manifest/i.test(e));
  check("浏览器控制台没有报错", noisy.length === 0, noisy.slice(0, 4));

  await page.screenshot({ path: `/tmp/ui-pages-${stamp}.png`, fullPage: false });
  console.log(`  截图 /tmp/ui-pages-${stamp}.png`);
} finally {
  await browser.close();

  console.log("\n【清理】");
  const ids = [markerUserId, adminId].filter(Boolean);
  if (ids.length) {
    await conn.query("DELETE FROM credit_transactions WHERE user_id IN (?)", [ids]);
    await conn.query("DELETE FROM subscriptions WHERE user_id IN (?)", [ids]);
    await conn.query("DELETE FROM api_keys WHERE user_id IN (?)", [ids]);
    await conn.query("DELETE FROM user_budgets WHERE user_id IN (?)", [ids]);
    await conn.query("DELETE FROM users WHERE id IN (?)", [ids]);
  }
  if (markerPlanId) {
    await conn.query("DELETE FROM plan_prices WHERE plan_id = ?", [markerPlanId]);
    await conn.query("DELETE FROM plans WHERE id = ?", [markerPlanId]);
  }
  const [left] = (await conn.query("SELECT COUNT(*) n FROM users WHERE email LIKE ?", [`pages-admin-${stamp}%`])) as any[];
  check("本次测试账号已清理", Number(left[0].n) === 0, left[0]);
  await conn.end();

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  if (failures.length) {
    console.log("\n失败明细：");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}
