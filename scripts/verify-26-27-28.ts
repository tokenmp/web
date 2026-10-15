/**
 * #26 取消退款 / #27 密钥 PATCH / #28 套餐换档的端到端验证。
 *
 * 不起服务器：直接拿路由导出的 handler 来调，请求里带一个现签的会话 cookie
 * （会话是无状态 JWT，见 src/lib/auth.ts 的 signSession）。
 * 测试用户与测试套餐都是本脚本现建的，结束后按 id 删干净，不碰库里的其它数据。
 *
 *   bun run scripts/verify-26-27-28.ts
 *
 * 依赖本地 MySQL（sudo docker compose up -d）。脚本结尾 process.exit，
 * 免得 mysql 连接池把进程吊住。
 */
import mysql from "mysql2/promise";

import { signSession } from "../src/lib/auth";

import { GET as myKeysGet, POST as myKeysPost } from "../src/routes/api/user/api_keys";
import { PATCH as myKeyPatch } from "../src/routes/api/user/api_keys/[id]";
import { PATCH as adminKeyPatch } from "../src/routes/api/admin/api_keys/[id]";
import { PATCH as adminUserKeysPatch } from "../src/routes/api/admin/users/[id]/api_keys";
import { POST as cancelPost } from "../src/routes/api/user/plans/cancel";
import { POST as subscribePost } from "../src/routes/api/user/plans/[id]/subscribe";
import { POST as adminSubscriptionPost } from "../src/routes/api/admin/users/[id]/subscription";
import { proratedRemainingQuota, refundableAmount, totalPeriodDays } from "../src/lib/quota";

type Handler = (event: unknown) => Promise<Response>;

async function call(
  handler: unknown,
  options: {
    method?: string;
    path: string;
    body?: unknown;
    token?: string | null;
    params?: Record<string, string>;
  },
) {
  const headers: Record<string, string> = {};
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
    // 非 JSON 就保留原文
  }
  return { status: response.status, body };
}

// timezone 必须跟 src/lib/db.ts 一致（Z）：不一致的话写进去的 Date 会被本地时区
// 平移，读回来再按 UTC 解释，period 就偏了几小时，折算比值全错。
const conn = await mysql.createConnection({
  uri: process.env.DATABASE_URL ?? "mysql://tokenmp:tokenmp-dev@127.0.0.1:3307/tokenmp",
  timezone: "Z",
});

const DAY = 24 * 60 * 60 * 1000;
const stamp = Date.now();
const nameA = `tv-a-${stamp}`;
const nameB = `tv-b-${stamp}`;
const planName = (tag: string) => `tv-plan-${tag}-${stamp}`;

let failed = 0;
let passed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` -> ${JSON.stringify(detail)}`}`);
  }
}
function near(a: number, b: number, eps = 0.001) {
  return Math.abs(a - b) < eps;
}

let userA = 0;
let userB = 0;
const planIds: number[] = [];
let tokenA = "";
let tokenB = "";
let adminToken = "";

async function insertUser(name: string) {
  const [res]: any = await conn.query(
    "INSERT INTO users (name, email, password_hash, role, status, credit_limit, balance, credit_used, token_version, source, created_at, updated_at) " +
      "VALUES (?, ?, 'x', 'user', 1, 0, 0, 0, 0, 'local', NOW(3), NOW(3))",
    [name, `${name}@example.com`],
  );
  return Number(res.insertId);
}

async function insertPlan(tag: string, kind: string, quota: number, price: number, days = 30) {
  const [res]: any = await conn.query(
    "INSERT INTO plans (name, mode, pricing_mode, quota_kind, quota_amount, quota_period_days, price, status, created_at, updated_at) " +
      "VALUES (?, 'subscription', 'table', ?, ?, ?, ?, 1, NOW(3), NOW(3))",
    [planName(tag), kind, quota, days, price],
  );
  return Number(res.insertId);
}

/** 建一条生效订阅，返回订阅 id。默认定在周期中段（已用一半） */
async function insertSub(
  userId: number,
  planId: number,
  kind: string,
  quota: number,
  opts: { usedDays?: number; totalDays?: number; price?: number } = {},
) {
  const used = opts.usedDays ?? 15;
  const total = opts.totalDays ?? 30;
  const now = Date.now();
  const start = new Date(now - used * DAY);
  const end = new Date(now + (total - used) * DAY);
  const [res]: any = await conn.query(
    "INSERT INTO subscriptions (user_id, plan_id, amount, quota_kind, quota_limit, quota_used, period_start, period_end, status, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'active', NOW(3), NOW(3))",
    [userId, planId, String(opts.price ?? quota), kind, String(quota), start, end],
  );
  return Number(res.insertId);
}

async function setAccount(userId: number, balance: number, creditLimit = 0, creditUsed = 0) {
  await conn.query(
    "UPDATE users SET balance = ?, credit_limit = ?, credit_used = ? WHERE id = ?",
    [balance, creditLimit, creditUsed, userId],
  );
}
async function setPlan(userId: number, planId: number | null) {
  await conn.query("UPDATE users SET plan_id = ? WHERE id = ?", [planId, userId]);
}
async function countSubs(userId: number) {
  const [r]: any = await conn.query("SELECT COUNT(*) n FROM subscriptions WHERE user_id = ?", [userId]);
  return Number(r[0].n);
}
async function countTx(userId: number, source?: string) {
  const [r]: any = await conn.query(
    `SELECT COUNT(*) n FROM credit_transactions WHERE user_id = ?${source ? " AND source = ?" : ""}`,
    source ? [userId, source] : [userId],
  );
  return Number(r[0].n);
}
async function getUser(userId: number) {
  const [r]: any = await conn.query("SELECT balance, credit_used, plan_id, credit_limit FROM users WHERE id = ?", [userId]);
  return r[0];
}
async function getSubs(userId: number) {
  const [r]: any = await conn.query(
    "SELECT id, plan_id, status, quota_kind, quota_limit, period_start, period_end FROM subscriptions WHERE user_id = ? ORDER BY id",
    [userId],
  );
  return r;
}

/** 清掉某个用户的订阅：取消用；测试每个场景前恢复到干净起点 */
async function clearUser(userId: number) {
  await conn.query("DELETE FROM credit_transactions WHERE user_id = ?", [userId]);
  await conn.query("DELETE FROM subscriptions WHERE user_id = ?", [userId]);
  await conn.query("DELETE FROM api_keys WHERE user_id = ?", [userId]);
  await setAccount(userId, 0, 0, 0);
  await setPlan(userId, null);
}

try {
  /* ---------------------------------------------------------- 准备数据 */
  userA = await insertUser(nameA);
  userB = await insertUser(nameB);
  tokenA = await signSession({ sub: userA, tv: 0, role: "user" });
  tokenB = await signSession({ sub: userB, tv: 0, role: "user" });

  const [admin]: any = await conn.query(
    "SELECT id, name, role, token_version FROM users WHERE role = 'admin' AND status = 1 LIMIT 1",
  );
  if (!admin[0]) throw new Error("库里没有可用的管理员，先跑一次 db/init");
  adminToken = await signSession({ sub: Number(admin[0].id), tv: Number(admin[0].token_version), role: "admin" });

  const planP = await insertPlan("P", "money", 100, 100); // 旧档：100 元 / 100 订阅额度 / 30 天
  const planQ = await insertPlan("Q", "money", 200, 200); // 高档：200 元
  const planS = await insertPlan("S", "requests", 1000, 50); // 按次包：1000 次 / 50 元
  planIds.push(planP, planQ, planS);

  /* ------------------------------------------- 换算式纯函数边界 */
  console.log("\n[折算函数]");
  const now = new Date();
  check(
    "剩余 0 天（period_end 已过）回 0",
    refundableAmount(
      { quotaKind: "money", quotaLimit: 100, periodStart: new Date(now.getTime() - 31 * DAY), periodEnd: new Date(now.getTime() - DAY) },
      now,
    ) === 0,
  );
  check(
    "刚订满周期 ≈ 全额",
    near(
      refundableAmount(
        { quotaKind: "money", quotaLimit: 100, periodStart: now, periodEnd: new Date(now.getTime() + 30 * DAY) },
        now,
      ),
      100,
    ),
  );
  const requestsWindow = {
    quotaKind: "requests",
    quotaLimit: 1000,
    periodStart: new Date(now.getTime() - 15 * DAY),
    periodEnd: new Date(now.getTime() + 15 * DAY),
  };
  check("requests 退款按 0", refundableAmount(requestsWindow, now) === 0);
  check("requests 折算后仍是次数（不退钱但作废要显示）", near(proratedRemainingQuota(requestsWindow, now), 500));
  check(
    "period_end 缺失回 0",
    refundableAmount({ quotaKind: "money", quotaLimit: 100, periodStart: now, periodEnd: null }, now) === 0,
  );
  check(
    "period_start 缺失回落到套餐天数，半程 ≈ 50",
    near(
      refundableAmount(
        { quotaKind: "money", quotaLimit: 100, periodStart: null, periodEnd: new Date(now.getTime() + 15 * DAY), fallbackPeriodDays: 30 },
        now,
      ),
      50,
    ),
  );
  check(
    "总天数取实际区间（35 天）",
    near(totalPeriodDays({ periodStart: new Date(now.getTime() - 5 * DAY), periodEnd: new Date(now.getTime() + 30 * DAY) }), 35, 0.0001),
  );

  /* ------------------------------------------------ #27 密钥 */
  console.log("\n[#27 密钥 PATCH]");
  const created = await call(myKeysPost, {
    method: "POST",
    path: "/api/user/api_keys",
    token: tokenA,
    body: { name: "原始名" },
  });
  const keyA = created.body.data.id as number;

  const disabled = await call(myKeyPatch, {
    method: "PATCH",
    path: `/api/user/api_keys/${keyA}`,
    token: tokenA,
    params: { id: String(keyA) },
    body: { status: 0 },
  });
  check("停用回 200 且 status=0", disabled.status === 200 && disabled.body.data.status === 0, disabled.body);

  const listed = await call(myKeysGet, { path: "/api/user/api_keys", token: tokenA });
  const listedKey = listed.body.items.find((k: any) => k.id === keyA);
  check("停用后列表里还在且 status=0", !!listedKey && listedKey.status === 0, listedKey);

  const edited = await call(myKeyPatch, {
    method: "PATCH",
    path: `/api/user/api_keys/${keyA}`,
    token: tokenA,
    params: { id: String(keyA) },
    body: { name: "改名后", rate_limit_per_min: 120 },
  });
  const [keyRow]: any = await conn.query("SELECT name, rate_limit_per_min FROM api_keys WHERE id = ?", [keyA]);
  check(
    "改名与限速生效（含落库）",
    edited.status === 200 && edited.body.data.name === "改名后" && edited.body.data.rate_limit_per_min === 120 &&
      keyRow[0].name === "改名后" && keyRow[0].rate_limit_per_min === 120,
    { body: edited.body, row: keyRow[0] },
  );

  const badStatus = await call(myKeyPatch, {
    method: "PATCH",
    path: `/api/user/api_keys/${keyA}`,
    token: tokenA,
    params: { id: String(keyA) },
    body: { status: true },
  });
  check("status=true 回 400", badStatus.status === 400, badStatus.body);

  // userB 的一把密钥，userA 拿它的 id 来改
  const createdB = await call(myKeysPost, {
    method: "POST",
    path: "/api/user/api_keys",
    token: tokenB,
    body: { name: "B 的密钥" },
  });
  const keyB = createdB.body.data.id as number;
  const cross = await call(myKeyPatch, {
    method: "PATCH",
    path: `/api/user/api_keys/${keyB}`,
    token: tokenA,
    params: { id: String(keyB) },
    body: { status: 0 },
  });
  const [keyBRow]: any = await conn.query("SELECT status FROM api_keys WHERE id = ?", [keyB]);
  check("用户端改别人的密钥回 404 且未改动", cross.status === 404 && keyBRow[0].status === 1, cross.body);

  const adminEdit = await call(adminKeyPatch, {
    method: "PATCH",
    path: `/api/admin/api_keys/${keyA}`,
    token: adminToken,
    params: { id: String(keyA) },
    body: { model_whitelist: ["gpt-4o", "deepseek-v3"], status: 1 },
  });
  check(
    "管理端改白名单与启用",
    adminEdit.status === 200 && adminEdit.body.data.status === 1 &&
      JSON.stringify(adminEdit.body.data.model_whitelist) === JSON.stringify(["gpt-4o", "deepseek-v3"]),
    adminEdit.body,
  );

  const adminUserEdit = await call(adminUserKeysPatch, {
    method: "PATCH",
    path: `/api/admin/users/${userB}/api_keys`,
    token: adminToken,
    params: { id: String(userB) },
    body: { key_id: keyB, name: "管理员改的名" },
  });
  check("管理端按用户改密钥（key_id）", adminUserEdit.status === 200 && adminUserEdit.body.data.name === "管理员改的名", adminUserEdit.body);

  const adminUserMissing = await call(adminUserKeysPatch, {
    method: "PATCH",
    path: "/api/admin/users/99999999/api_keys",
    token: adminToken,
    params: { id: "99999999" },
    body: { key_id: keyB },
  });
  check("管理端用户不存在回 404", adminUserMissing.status === 404, adminUserMissing.body);

  const adminScope = await call(adminUserKeysPatch, {
    method: "PATCH",
    path: `/api/admin/users/${userA}/api_keys`,
    token: adminToken,
    params: { id: String(userA) },
    body: { key_id: keyB, name: "越权" },
  });
  check("管理端 key_id 不属该用户回 404", adminScope.status === 404, adminScope.body);

  /* ------------------------------------------------ #26 用户取消 */
  console.log("\n[#26 用户取消订阅]");
  await clearUser(userA);
  const subCancel = await insertSub(userA, planP, "money", 100);
  await setPlan(userA, planP);
  const cancelled = await call(cancelPost, {
    method: "POST",
    path: "/api/user/plans/cancel",
    token: tokenA,
    body: undefined,
  });
  const afterCancelUser = await getUser(userA);
  const [cancelSubRow]: any = await conn.query("SELECT status FROM subscriptions WHERE id = ?", [subCancel]);
  check(
    "取消成功并回剩余订阅额度",
    cancelled.status === 200 && cancelled.body.data.plan_id === planP && near(cancelled.body.data.forfeited_quota, 50, 0.01),
    cancelled.body,
  );
  check(
    "订阅置 cancelled 且 users.plan_id 变 null",
    cancelSubRow[0].status === "cancelled" && afterCancelUser.plan_id === null,
    { sub: cancelSubRow[0], user: afterCancelUser },
  );

  const cancelAgain = await call(cancelPost, { method: "POST", path: "/api/user/plans/cancel", token: tokenA });
  check("没有生效订阅时回 404", cancelAgain.status === 404, cancelAgain.body);

  /* ------------------------------------------ #26 管理端退订退款 */
  console.log("\n[#26 管理端退订与退款]");
  await clearUser(userA);
  const subRefund = await insertSub(userA, planP, "money", 100);
  await setPlan(userA, planP);
  await setAccount(userA, 50);

  const refunded = await call(adminSubscriptionPost, {
    method: "POST",
    path: `/api/admin/users/${userA}/subscription`,
    token: adminToken,
    params: { id: String(userA) },
    body: { refund: true, reason: "测试退款" },
  });
  const afterRefund = await getUser(userA);
  const [refundTx]: any = await conn.query(
    "SELECT delta, source, ref_id, operator, reason FROM credit_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 1",
    [userA],
  );
  check("refund=true 退款 ≈ 剩余订阅额度折算价", refunded.status === 200 && near(refunded.body.data.refunded, 50, 0.01), refunded.body);
  check("余额增加到 100", near(Number(afterRefund.balance), 100, 0.01), afterRefund);
  check(
    "流水 source=refund 且指回订阅",
    refundTx[0].source === "refund" && refundTx[0].ref_id === `refund-${subRefund}` && near(Number(refundTx[0].delta), 50, 0.01),
    refundTx[0],
  );

  await clearUser(userA);
  await insertSub(userA, planP, "money", 100);
  await setPlan(userA, planP);
  await setAccount(userA, 50);
  const beforeNoRefundTx = await countTx(userA, "refund");
  const noRefund = await call(adminSubscriptionPost, {
    method: "POST",
    path: `/api/admin/users/${userA}/subscription`,
    token: adminToken,
    params: { id: String(userA) },
    body: { refund: false },
  });
  const afterNoRefund = await getUser(userA);
  check(
    "refund=false 不加钱、不记退款流水",
    noRefund.status === 200 && noRefund.body.data.refunded === 0 && near(Number(afterNoRefund.balance), 50, 0.01) &&
      (await countTx(userA, "refund")) === beforeNoRefundTx && afterNoRefund.plan_id === null,
    { body: noRefund.body, user: afterNoRefund },
  );

  /* ------------------------------------------------ #28 换档 */
  console.log("\n[#28 套餐换档]");
  await clearUser(userA);
  await insertSub(userA, planP, "money", 100);
  await setPlan(userA, planP);
  await setAccount(userA, 200);

  const nowBefore = new Date();
  const [subP]: any = await conn.query(
    "SELECT period_start, period_end FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
    [userA],
  );
  const expectedCredit = refundableAmount(
    {
      quotaKind: "money",
      quotaLimit: 100,
      periodStart: new Date(subP[0].period_start),
      periodEnd: new Date(subP[0].period_end),
    },
    nowBefore,
  );

  const swapped = await call(subscribePost, {
    method: "POST",
    path: `/api/user/plans/${planQ}/subscribe`,
    token: tokenA,
    params: { id: String(planQ) },
  });
  const afterSwapUser = await getUser(userA);
  const subsAfterSwap = await getSubs(userA);
  const [swapTx]: any = await conn.query(
    "SELECT delta, ref_id, source FROM credit_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 1",
    [userA],
  );
  const expectedCharged = 200 - expectedCredit;
  check(
    "换档扣款 = 新价 - 剩余订阅额度折算价",
    swapped.status === 200 && near(swapped.body.charged, expectedCharged, 0.01) && swapped.body.from_plan_id === planP,
    { body: swapped.body, expectedCharged },
  );
  check("换档流水金额对得上且 ref_id 指向新套餐", near(Number(swapTx[0].delta), -expectedCharged, 0.01) && swapTx[0].ref_id === `plan-${planQ}` && swapTx[0].source === "subscription", swapTx[0]);
  check("余额 = 200 - 应付", near(Number(afterSwapUser.balance), 200 - expectedCharged, 0.01), afterSwapUser);
  const oldRow = subsAfterSwap.find((s: any) => s.plan_id === planP);
  const newRow = subsAfterSwap.find((s: any) => s.plan_id === planQ);
  check("旧订阅变 superseded", oldRow?.status === "superseded", subsAfterSwap);
  check("新订阅行在库里且 active", !!newRow && newRow.status === "active", subsAfterSwap);
  check("plan_id 切到新套餐", Number(afterSwapUser.plan_id) === planQ, afterSwapUser);

  // 402 回滚
  await clearUser(userA);
  const subRollback = await insertSub(userA, planP, "money", 100);
  await setPlan(userA, planP);
  await setAccount(userA, 10);
  const beforeSubs = await countSubs(userA);
  const beforeTx = await countTx(userA);
  const blocked = await call(subscribePost, {
    method: "POST",
    path: `/api/user/plans/${planQ}/subscribe`,
    token: tokenA,
    params: { id: String(planQ) },
  });
  const afterBlocked = await getUser(userA);
  const [rollbackSub]: any = await conn.query("SELECT status FROM subscriptions WHERE id = ?", [subRollback]);
  check(
    "余额不足回 402 且无任何写入",
    blocked.status === 402 && (await countSubs(userA)) === beforeSubs && (await countTx(userA)) === beforeTx &&
      near(Number(afterBlocked.balance), 10, 0.01) && rollbackSub[0].status === "active" && Number(afterBlocked.plan_id) === planP,
    { status: blocked.status, body: blocked.body, user: afterBlocked },
  );

  // requests 类型换档不抵扣
  await clearUser(userA);
  await insertSub(userA, planS, "requests", 1000, { price: 50 });
  await setPlan(userA, planS);
  await setAccount(userA, 200);
  const requestsSwap = await call(subscribePost, {
    method: "POST",
    path: `/api/user/plans/${planQ}/subscribe`,
    token: tokenA,
    params: { id: String(planQ) },
  });
  const afterRequests = await getUser(userA);
  check(
    "按次套餐换档整额扣款（不抵扣）",
    requestsSwap.status === 200 && near(requestsSwap.body.charged, 200, 0.01) && near(Number(afterRequests.balance), 0, 0.01),
    { body: requestsSwap.body, user: afterRequests },
  );
} catch (err) {
  failed += 1;
  console.error("\n脚本异常：", err);
} finally {
  // 只删本脚本建的行：按用户 id 与套餐 id
  for (const uid of [userA, userB]) {
    if (!uid) continue;
    await conn.query("DELETE FROM credit_transactions WHERE user_id = ?", [uid]);
    await conn.query("DELETE FROM subscriptions WHERE user_id = ?", [uid]);
    await conn.query("DELETE FROM api_keys WHERE user_id = ?", [uid]);
    await conn.query("DELETE FROM user_budgets WHERE user_id = ?", [uid]);
    await conn.query("DELETE FROM users WHERE id = ?", [uid]);
  }
  if (planIds.length) {
    await conn.query(`DELETE FROM plan_prices WHERE plan_id IN (${planIds.map(() => "?").join(",")})`, planIds);
    await conn.query(`DELETE FROM subscriptions WHERE plan_id IN (${planIds.map(() => "?").join(",")})`, planIds);
    await conn.query(`DELETE FROM plans WHERE id IN (${planIds.map(() => "?").join(",")})`, planIds);
  }
  await conn.end();
}

console.log(`\n通过 ${passed} 条，失败 ${failed} 条`);
process.exit(failed > 0 ? 1 : 0);
