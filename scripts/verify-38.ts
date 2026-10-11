/**
 * #38 管理端充值单列表的端到端验证。
 *
 * 不起服务器：直接拿路由导出的 GET handler 来调，请求里带一个现签的会话 cookie
 * （会话是无状态 JWT，见 src/lib/auth.ts 的 signSession）。造数据的两个用户与
 * 五条充值单都是本脚本现建的，结束后按 order_no 与用户 id 删干净，不碰库里其它数据。
 *
 *   bun run scripts/verify-38.ts
 *
 * 依赖本地 MySQL（sudo docker compose up -d）。脚本结尾 process.exit，
 * 免得 mysql 连接池把进程吊住。
 */
import mysql from "mysql2/promise";

import { signSession } from "../src/lib/auth";
import { GET as adminRechargeGet } from "../src/routes/api/admin/recharge";

type Handler = (event: unknown) => Promise<Response>;

async function call(
  handler: unknown,
  options: { path: string; token?: string | null },
) {
  const headers: Record<string, string> = {};
  if (options.token) headers.cookie = `tokenmp_session=${options.token}`;

  const request = new Request(`http://localhost:6789${options.path}`, { method: "GET", headers });
  const response = await (handler as Handler)({ request, params: {} });
  const text = await response.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // 非 JSON 就保留原文
  }
  return { status: response.status, body };
}

// timezone 必须跟 src/lib/db.ts 一致（Z），否则写进去的 Date 会被本地时区平移
const conn = await mysql.createConnection({
  uri: process.env.DATABASE_URL ?? "mysql://tokenmp:tokenmp-dev@127.0.0.1:3307/tokenmp",
  timezone: "Z",
});

const DAY = 24 * 60 * 60 * 1000;
const stamp = Date.now();
const nameX = `tr-x-${stamp}`;
const nameY = `tr-y-${stamp}`;

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

let userX = 0;
let userY = 0;
let tokenX = "";
let adminToken = "";
const orderNos: string[] = [];

async function insertUser(name: string) {
  const [res]: any = await conn.query(
    "INSERT INTO users (name, email, password_hash, role, status, credit_limit, balance, credit_used, token_version, source, created_at, updated_at) " +
      "VALUES (?, ?, 'x', 'user', 1, 0, 0, 0, 0, 'local', NOW(3), NOW(3))",
    [name, `${name}@example.com`],
  );
  return Number(res.insertId);
}

async function countWhere(where: string, params: unknown[] = []) {
  const [r]: any = await conn.query(`SELECT COUNT(*) n FROM recharge_orders ${where}`, params);
  return Number(r[0].n);
}

/** 造一条充值单，返回 order_no */
async function insertOrder(input: {
  tag: string;
  userId: number;
  amount: number;
  channel: string;
  status: string;
  createdAt: Date;
  paidAt?: Date | null;
  creditTransactionId?: number | null;
  externalNo?: string | null;
}) {
  const orderNo = `tv-${input.tag}-${stamp}`;
  orderNos.push(orderNo);
  await conn.query(
    "INSERT INTO recharge_orders (order_no, user_id, amount, currency, channel, status, external_no, paid_at, credit_transaction_id, created_at, updated_at) " +
      "VALUES (?, ?, ?, 'CNY', ?, ?, ?, ?, ?, ?, ?)",
    [
      orderNo,
      input.userId,
      input.amount.toFixed(8),
      input.channel,
      input.status,
      input.externalNo ?? null,
      input.paidAt ?? null,
      input.creditTransactionId ?? null,
      input.createdAt,
      input.createdAt,
    ],
  );
  return orderNo;
}

// 时间戳取整秒，避免毫秒在 datetime(3) 与 ISO 串之间来回时对不上
const now = Math.floor(Date.now() / 1000) * 1000;
const at = (offsetMs: number) => new Date(now + offsetMs);

let r1 = "";
let r2 = "";
let r3 = "";
let r4 = "";
let r5 = "";
const r2CreatedAt = at(-2 * DAY);

try {
  /* ---------------------------------------------------------- 准备数据 */
  const baseline = await countWhere("");
  if (baseline > 0) console.log(`注意：库里本来就有 ${baseline} 条充值单，断言按差值算`);

  userX = await insertUser(nameX);
  userY = await insertUser(nameY);
  tokenX = await signSession({ sub: userX, tv: 0, role: "user" });

  const [admin]: any = await conn.query(
    "SELECT id, token_version FROM users WHERE role = 'admin' AND status = 1 LIMIT 1",
  );
  if (!admin[0]) throw new Error("库里没有可用的管理员，先跑一次 db/init");
  adminToken = await signSession({
    sub: Number(admin[0].id),
    tv: Number(admin[0].token_version),
    role: "admin",
  });

  r1 = await insertOrder({
    tag: "x-pending",
    userId: userX,
    amount: 10,
    channel: "mock",
    status: "pending",
    createdAt: at(-3 * DAY),
  });
  r2 = await insertOrder({
    tag: "x-paid",
    userId: userX,
    amount: 12.5,
    channel: "mock",
    status: "paid",
    createdAt: r2CreatedAt,
    paidAt: new Date(r2CreatedAt.getTime() + 300_000),
    externalNo: "ext-0001",
    creditTransactionId: 555001,
  });
  r3 = await insertOrder({
    tag: "x-failed",
    userId: userX,
    amount: 7.25,
    channel: "alipay",
    status: "failed",
    createdAt: at(-1 * DAY),
  });
  r4 = await insertOrder({
    tag: "y-pending",
    userId: userY,
    amount: 100,
    channel: "mock",
    status: "pending",
    createdAt: at(-12 * 60 * 60 * 1000),
  });
  r5 = await insertOrder({
    tag: "y-cancelled",
    userId: userY,
    amount: 3,
    channel: "mock",
    status: "cancelled",
    createdAt: at(-1 * 60 * 60 * 1000),
  });

  const totalAll = baseline + 5;

  /* -------------------------------------------------------- 权限 */
  console.log("\n[权限]");
  const anon = await call(adminRechargeGet, { path: "/api/admin/recharge" });
  check("未登录回 401", anon.status === 401, anon.body);

  const asUser = await call(adminRechargeGet, {
    path: "/api/admin/recharge",
    token: tokenX,
  });
  check("普通用户回 403", asUser.status === 403, asUser.body);

  /* ---------------------------------------------------- 无筛选与形状 */
  console.log("\n[列表]");
  const all = await call(adminRechargeGet, {
    path: "/api/admin/recharge?size=100",
    token: adminToken,
  });
  check("无筛选 total 等于基线加造出的 5 条", all.status === 200 && all.body.total === totalAll, all.body.total);
  check("每条都带 user_name 与 user_email", all.body.items.every((i: any) => typeof i.user_name === "string" && "user_email" in i));

  const returned = all.body.items.map((i: any) => i.order_no);
  check("造出的单号都在返回里", orderNos.every(no => returned.includes(no)), { returned });

  const times = all.body.items.map((i: any) => new Date(i.created_at).getTime());
  check(
    "按 created_at 倒序",
    times.every((t: number, idx: number) => idx === 0 || times[idx - 1] >= t),
    times,
  );

  const paidItem = all.body.items.find((i: any) => i.order_no === r2);
  check(
    "已到账单带上 paid_at、external_no 与 credit_transaction_id，金额是数字",
    !!paidItem && paidItem.amount === 12.5 && typeof paidItem.credit_transaction_id === "number" &&
      paidItem.credit_transaction_id === 555001 && paidItem.external_no === "ext-0001" && !!paidItem.paid_at,
    paidItem,
  );

  /* -------------------------------------------------------- 状态筛选 */
  console.log("\n[状态筛选]");
  const pendingExpected = await countWhere("WHERE status = 'pending'");
  const pending = await call(adminRechargeGet, {
    path: "/api/admin/recharge?status=pending&size=100",
    token: adminToken,
  });
  check("status=pending 条数对得上", pending.status === 200 && pending.body.total === pendingExpected, {
    got: pending.body.total,
    expected: pendingExpected,
  });
  check("每条都是 pending", pending.body.items.every((i: any) => i.status === "pending"));
  check("两类待支付都在", [r1, r4].every(no => pending.body.items.some((i: any) => i.order_no === no)));

  const failedOnly = await call(adminRechargeGet, {
    path: "/api/admin/recharge?status=failed&size=100",
    token: adminToken,
  });
  check(
    "status=failed 只回失败那一单",
    failedOnly.body.total === (await countWhere("WHERE status = 'failed'")) &&
      failedOnly.body.items.every((i: any) => i.status === "failed"),
    failedOnly.body,
  );

  /* --------------------------------------------------------- 用户筛选 */
  console.log("\n[用户筛选]");
  const byUser = await call(adminRechargeGet, {
    path: `/api/admin/recharge?user_id=${userX}&size=100`,
    token: adminToken,
  });
  check("user_id 筛出该用户的 3 单", byUser.body.total === 3 && byUser.body.items.length === 3, byUser.body.total);
  check("返回的每条都属于该用户", byUser.body.items.every((i: any) => i.user_id === userX));

  const combo = await call(adminRechargeGet, {
    path: `/api/admin/recharge?user_id=${userX}&status=pending&size=100`,
    token: adminToken,
  });
  check("user_id + status 组合筛出 1 单", combo.body.total === 1 && combo.body.items[0]?.order_no === r1, combo.body);

  /* --------------------------------------------------------- 渠道筛选 */
  console.log("\n[渠道筛选]");
  const byChannel = await call(adminRechargeGet, {
    path: "/api/admin/recharge?channel=mock&size=100",
    token: adminToken,
  });
  check(
    "channel=mock 只回 mock 的单，条数对得上",
    byChannel.body.total === (await countWhere("WHERE channel = 'mock'")) &&
      byChannel.body.items.every((i: any) => i.channel === "mock"),
    byChannel.body,
  );

  /* --------------------------------------------------------- 时间筛选 */
  console.log("\n[时间筛选]");
  const boundary = await call(adminRechargeGet, {
    path: `/api/admin/recharge?user_id=${userX}&start=${encodeURIComponent(r2CreatedAt.toISOString())}&end=${encodeURIComponent(r2CreatedAt.toISOString())}&size=100`,
    token: adminToken,
  });
  check(
    "start=end 取到边界那一单（两端都含）",
    boundary.body.total === 1 && boundary.body.items[0]?.order_no === r2,
    boundary.body,
  );

  const windowed = await call(adminRechargeGet, {
    path: `/api/admin/recharge?user_id=${userX}&start=${encodeURIComponent(at(-3 * DAY).toISOString())}&end=${encodeURIComponent(at(-1 * DAY).toISOString())}&size=100`,
    token: adminToken,
  });
  check("闭区间覆盖 3 单", windowed.body.total === 3, windowed.body.total);

  const halfOpen = await call(adminRechargeGet, {
    path: `/api/admin/recharge?user_id=${userX}&start=${encodeURIComponent(at(-1 * DAY - 1000).toISOString())}&end=${encodeURIComponent(at(-1 * DAY + 1000).toISOString())}&size=100`,
    token: adminToken,
  });
  check("窗口只命中边界附近那单", halfOpen.body.total === 1 && halfOpen.body.items[0]?.order_no === r3, halfOpen.body);

  /* ------------------------------------------------------- 非法输入忽略 */
  console.log("\n[非法输入静默忽略]");
  const badCases: [string, string][] = [
    ["非法 status", "status=bogus"],
    ["非法 user_id", "user_id=abc"],
    ["非法 channel", "channel=" + encodeURIComponent("有 空格!")],
    ["非法 start", "start=not-a-date"],
    ["非法 end", "end=2026-13-45"],
  ];
  for (const [label, qs] of badCases) {
    const res = await call(adminRechargeGet, {
      path: `/api/admin/recharge?${qs}&size=100`,
      token: adminToken,
    });
    check(`${label} 回 200 且不过滤`, res.status === 200 && res.body.total === totalAll, {
      status: res.status,
      total: res.body.total,
    });
  }

  /* ----------------------------------------------------------- 分页 */
  console.log("\n[分页]");
  const p1 = await call(adminRechargeGet, {
    path: `/api/admin/recharge?user_id=${userX}&size=1&page=1`,
    token: adminToken,
  });
  const p2 = await call(adminRechargeGet, {
    path: `/api/admin/recharge?user_id=${userX}&size=1&page=2`,
    token: adminToken,
  });
  const p4 = await call(adminRechargeGet, {
    path: `/api/admin/recharge?user_id=${userX}&size=1&page=4`,
    token: adminToken,
  });
  check("size=1 时 total 仍是筛选后的总数", p1.body.total === 3 && p2.body.total === 3 && p4.body.total === 3, {
    p1: p1.body.total,
    p2: p2.body.total,
    p4: p4.body.total,
  });
  check("每页各回一条", p1.body.items.length === 1 && p2.body.items.length === 1);
  check("两页内容不同", p1.body.items[0]?.order_no !== p2.body.items[0]?.order_no);
  check("越界页回空数组但 total 不变", p4.body.items.length === 0 && p4.body.total === 3);

  const orderedPaged = [p1, p2].map(r => r.body.items[0]?.order_no);
  check("翻页按倒序推进", orderedPaged[0] === r3 && orderedPaged[1] === r2, orderedPaged);
} catch (err) {
  failed += 1;
  console.error("\n脚本异常：", err);
} finally {
  // 只删本脚本建的行：按 order_no 与用户 id，不碰库里其它数据
  if (orderNos.length) {
    await conn.query(`DELETE FROM recharge_orders WHERE order_no IN (${orderNos.map(() => "?").join(",")})`, orderNos);
  }
  for (const uid of [userX, userY]) {
    if (!uid) continue;
    await conn.query("DELETE FROM recharge_orders WHERE user_id = ?", [uid]);
    await conn.query("DELETE FROM users WHERE id = ?", [uid]);
  }
  await conn.end();
}

console.log(`\n通过 ${passed} 条，失败 ${failed} 条`);
process.exit(failed > 0 ? 1 : 0);
