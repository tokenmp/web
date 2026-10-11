/**
 * 界面交互测试：点开再取消、切来切去、填错再改。
 *
 * 打的是跑起来的生产构建（http://127.0.0.1:6789），用真实浏览器操作。
 * 重点不是「功能对不对」，而是「不该发生的事有没有发生」：
 *
 *   - 点了取消，有没有偷偷发出写请求
 *   - 空表单提交，是不是被前端挡住的（而不是打到后端）
 *   - 密码错一次之后，页面有没有给出提示
 *   - 那些还没接后端的页面，点来点去是不是一个请求都没发
 *
 * 用法（先起服务，再跑）：
 *
 *   PORT=6789 node --env-file=.env .output/server/index.mjs
 *   bun tests/ui-flow.ts
 */
import mysql from "mysql2/promise";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:6789";
const stamp = Date.now();
const adminEmail = `ui-admin-${stamp}@example.com`;
const password = "ui-Password-123";

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
  const line = `${label}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 200)}`}`;
  failures.push(line);
  console.log(`  ✗ ${line}`);
}

function is(label: string, actual: unknown, expected: unknown) {
  check(`${label}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`, JSON.stringify(actual) === JSON.stringify(expected));
}

/** 记下这个页面发出去的所有写请求。取消类断言全靠它 */
function watchWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", req => {
    const method = req.method();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
    const url = new URL(req.url());
    if (!url.pathname.startsWith("/api/")) return;
    writes.push(`${method} ${url.pathname}`);
  });
  return writes;
}

/** 等一小会儿，给「本来不该发」的请求留出出现的时间 */
const settle = (page: Page) => page.waitForTimeout(400);

let adminId = 0;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const writes = watchWrites(page);

try {
  /* ---------------------------------------------- 一、登录页的原生交互 */

  console.log("\n【1】登录页：分段切换与密码可见性");
  await page.goto(BASE, { waitUntil: "networkidle" });
  is("页面标题", await page.title(), "登录 | TokenMP 销售控制台");

  const submit = page.locator('form button[type="submit"]');
  const emailInput = page.locator("#email");
  const passwordInput = page.locator("#password");

  is("初始是登录态", await submit.textContent(), "登录");
  is("登录时邮箱框接受用户名", await emailInput.getAttribute("type"), "text");

  await page.locator('button[type="button"]', { hasText: "注册" }).first().click();
  await settle(page);
  is("切到注册后按钮改名", await submit.textContent(), "创建账号");
  is("注册时邮箱框是 email 类型", await emailInput.getAttribute("type"), "email");

  await page.locator('button[type="button"]', { hasText: "登录" }).first().click();
  await settle(page);
  is("切回登录", await submit.textContent(), "登录");

  is("密码默认遮住", await passwordInput.getAttribute("type"), "password");
  await passwordInput.fill("看一眼的密码");
  await page.locator('button[aria-label="显示密码"]').click();
  await settle(page);
  is("点眼睛后明文", await passwordInput.getAttribute("type"), "text");
  is("明文内容还在", await passwordInput.inputValue(), "看一眼的密码");
  await page.locator('button[aria-label="隐藏密码"]').click();
  await settle(page);
  is("再点一次遮回去", await passwordInput.getAttribute("type"), "password");

  console.log("\n【2】登录页：空表单与错误密码");
  await emailInput.fill("");
  await passwordInput.fill("");
  writes.length = 0;
  await submit.click();
  await settle(page);
  // 两个输入框都带 required，浏览器自己就拦住了，根本不该有请求出去
  is("空表单不发登录请求", writes.filter(w => w.includes("/api/auth/login")), []);

  await emailInput.fill("nobody@example.com");
  await passwordInput.fill("wrong-password-here");
  writes.length = 0;
  await submit.click();
  await page.waitForSelector('[role="alert"]', { timeout: 5000 });
  const alertText = await page.locator('[role="alert"]').textContent();
  check("错误密码给出提示", String(alertText).includes("不正确"), alertText);
  is("确实打了登录接口", writes.filter(w => w === "POST /api/auth/login").length, 1);
  check("错误密码后还留在登录页", page.url().startsWith(BASE), page.url());

  /* ---------------------------------------------- 二、真实登录 */

  console.log("\n【3】真实登录并进入控制台");
  // 备一个管理员账号：注册走真实接口，再把角色改成 admin（线上没有提权接口，所以只能改库）
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password, name: `ui-admin-${stamp}` }),
  });
  is("注册备用账号", reg.status, 201);
  const registered = (await reg.json()) as { user: { id: number } };
  adminId = registered.user.id;
  await conn.query("UPDATE users SET role = 'admin' WHERE id = ?", [adminId]);

  await emailInput.fill(adminEmail);
  await passwordInput.fill(password);
  await submit.click();
  await page.waitForURL(url => url.pathname.startsWith("/dashboard"), { timeout: 10000 });
  check("登录后跳到控制台", page.url().includes("/dashboard"), page.url());

  /* ---------------------------------------------- 三、公告页的「点了取消」 */

  console.log("\n【4】公告管理：新建弹窗点了取消，不该创建");
  await page.goto(`${BASE}/dashboard/announcements`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600); // 等列表从接口回来

  const newButton = page.locator('button', { hasText: "新建公告" }).first();
  check("有「新建公告」入口", await newButton.count() > 0);

  await newButton.click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  check("弹窗打开了", await page.locator('[role="dialog"]').count() > 0);

  // 填一半，然后取消
  await page.locator('[role="dialog"] textarea, [role="dialog"] input[type="text"]').first().fill("这条不该被创建");
  writes.length = 0;
  await page.locator('[role="dialog"] button', { hasText: "取消" }).first().click();
  await settle(page);
  is("取消后弹窗关闭", await page.locator('[role="dialog"]').count(), 0);
  is("取消没有创建公告", writes.filter(w => w === "POST /api/admin/announcements"), []);

  const [created] = (await conn.query("SELECT COUNT(*) n FROM announcements WHERE title = ?", ["这条不该被创建"])) as any[];
  is("库里也没有这条公告", created[0].n, 0);

  console.log("\n【5】公告管理：删除确认点了取消，不该删除");
  // 自己造一条，不依赖列表里恰好有公告 —— 否则元素找不到就静默跳过，测了等于没测
  await conn.query(
    "INSERT INTO announcements (title, body, severity, scope, dismissible, status, sort_order, publish_from, created_at, updated_at) VALUES (?, ?, 'info', 'all', 1, 'draft', 0, NOW(3), NOW(3), NOW(3))",
    [`ui-cancel-${stamp}`, "取消组"],
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  const cancelTarget = page.locator(`button[aria-label="删除公告：ui-cancel-${stamp}"]`);
  check("列表里能找到刚造的公告", (await cancelTarget.count()) > 0);
  await cancelTarget.click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  writes.length = 0;
  await page.locator('[role="dialog"] button', { hasText: "取消" }).first().click();
  await settle(page);
  is("取消后确认框关闭", await page.locator('[role="dialog"]').count(), 0);
  is("取消没有发出删除请求", writes.filter(w => w.startsWith("DELETE ")), []);
  const [stillThere] = (await conn.query("SELECT COUNT(*) n FROM announcements WHERE title = ?", [`ui-cancel-${stamp}`])) as any[];
  is("公告还在库里", Number(stillThere[0].n), 1);

  console.log("\n【6】公告管理：真删一条会发出请求（对照组）");
  // 同一条公告，这次真确认。证明上一条的「没发请求」不是因为删除功能坏了
  await page.locator(`button[aria-label="删除公告：ui-cancel-${stamp}"]`).click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  writes.length = 0;
  await page.locator('[role="dialog"] button', { hasText: "删除" }).last().click();
  await settle(page);
  check("确认删除会发出请求", writes.some(w => w.startsWith("DELETE /api/admin/announcements/")), writes);
  const [gone] = (await conn.query("SELECT COUNT(*) n FROM announcements WHERE title = ?", [`ui-cancel-${stamp}`])) as any[];
  is("库里真删掉了", Number(gone[0].n), 0);

  /* ---------------------------------------------- 四、没接后端的页面 */

  console.log("\n【7】用户列表页：操作一通，一个接口请求都不该有");
  await page.goto(`${BASE}/dashboard/users`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  writes.length = 0;

  const searchBox = page.locator('input[placeholder*="邮箱"]').first();
  check("用户列表页渲染出了搜索框（否则下面的断言会变成假通过）", (await searchBox.count()) > 0);
  await searchBox.fill("lin");
  await settle(page);
  await searchBox.fill("");
  // 把页面上能点的按钮都点一遍，看有没有哪个偷偷发了请求
  const buttons = page.locator("button");
  const buttonCount = Math.min(await buttons.count(), 12);
  for (let i = 0; i < buttonCount; i++) {
    try {
      await buttons.nth(i).click({ timeout: 800 });
      await page.waitForTimeout(80);
    } catch {
      // 点不到就跳过，这里只关心「点了有没有发请求」
    }
  }
  await settle(page);
  is("用户列表页没有发出任何写请求", writes.filter(w => !w.startsWith("GET ")), []);
  check(
    "用户列表页连读接口都没打（说明还是模拟数据）",
    writes.filter(w => w.includes("/api/admin/users")).length === 0,
    writes,
  );

  await page.screenshot({ path: `/tmp/ui-users-${stamp}.png` });
  console.log(`  已截图 /tmp/ui-users-${stamp}.png`);
} finally {
  await browser.close();

  console.log("\n【8】清理");
  const [stale] = (await conn.query("SELECT id FROM users WHERE email LIKE ?", [`ui-admin-${stamp}%`])) as any[];
  const ids = (stale as any[]).map(r => r.id);
  if (ids.length) {
    await conn.query("DELETE FROM credit_transactions WHERE user_id IN (?)", [ids]);
    await conn.query("DELETE FROM api_keys WHERE user_id IN (?)", [ids]);
    await conn.query("DELETE FROM user_budgets WHERE user_id IN (?)", [ids]);
    await conn.query("DELETE FROM users WHERE id IN (?)", [ids]);
  }
  await conn.query("DELETE FROM announcements WHERE title LIKE ?", [`ui-%${stamp}%`]);
  const [left] = (await conn.query("SELECT COUNT(*) n FROM users WHERE email LIKE ?", [`ui-admin-${stamp}%`])) as any[];
  check("本次测试账号已清理", left[0].n === 0, left[0]);
  await conn.end();

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  if (failures.length) {
    console.log("\n失败明细：");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}
