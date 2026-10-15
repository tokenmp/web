/**
 * #36 批量充值端点的进程内验证。
 *
 * 不起服务器：直接取路由导出的 POST handler 来调，请求里带一个现签的会话 cookie
 * （会话是无状态 JWT，见 src/lib/auth.ts 的 signSession）。测试用户都是本脚本现建的，
 * 结束后按 id 删干净，不碰库里其它数据。
 *
 *   bun run scripts/verify-36.ts
 *
 * 依赖本地 MySQL（3307）。脚本结尾 process.exit，免得连接池把进程吊住。
 */
import mysql from "mysql2/promise";

import { signSession } from "../src/lib/auth";
import { POST as batchPost } from "../src/routes/api/admin/balances/batch-adjust";

type Handler = (event: unknown) => Promise<Response>;

async function call(options: {
  method?: string;
  path: string;
  body?: unknown;
  token?: string | null;
}) {
  const headers: Record<string, string> = {};
  if (options.token) headers.cookie = `tokenmp_session=${options.token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const request = new Request(`http://localhost:6789${options.path}`, {
    method: options.method ?? "POST",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const response = await (batchPost as unknown as Handler)({ request, params: {} });
  const text = await response.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // 非 JSON 就保留原文
  }
  return { status: response.status, body };
}

const conn = await mysql.createConnection({
  uri: process.env.DATABASE_URL ?? "mysql://tokenmp:tokenmp-dev@127.0.0.1:3307/tokenmp",
  timezone: "Z",
});

const stamp = Date.now();
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
function near(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

const userIds: number[] = [];
let adminToken = "";

async function insertUser(tag: string) {
  const id = `v36-${tag}-${stamp}`;
  const [res]: any = await conn.query(
    "INSERT INTO users (name, email, password_hash, role, status, credit_limit, balance, credit_used, token_version, source, created_at, updated_at) " +
      "VALUES (?, ?, 'x', 'user', 1, 0, 0, 0, 0, 'local', NOW(3), NOW(3))",
    [id, `${id}@example.com`],
  );
  const userId = Number(res.insertId);
  userIds.push(userId);
  return userId;
}

async function setAccount(userId: number, balance: number, creditLimit = 0, creditUsed = 0) {
  await conn.query("UPDATE users SET balance = ?, credit_limit = ?, credit_used = ? WHERE id = ?", [
    balance,
    creditLimit,
    creditUsed,
    userId,
  ]);
}

async function getAccount(userId: number) {
  const [r]: any = await conn.query(
    "SELECT balance, credit_limit, credit_used FROM users WHERE id = ?",
    [userId],
  );
  return r[0];
}

async function countTx(userId: number) {
  const [r]: any = await conn.query(
    "SELECT COUNT(*) n FROM credit_transactions WHERE user_id = ?",
    [userId],
  );
  return Number(r[0].n);
}

/** 清掉这批测试用户的流水，余额归零，便于场景之间互不干扰 */
async function clearTx(userId: number) {
  await conn.query("DELETE FROM credit_transactions WHERE user_id = ?", [userId]);
  await setAccount(userId, 0, 0, 0);
}

try {
  const [adminRows]: any = await conn.query(
    "SELECT id, token_version FROM users WHERE role = 'admin' AND status = 1 LIMIT 1",
  );
  if (!adminRows[0]) throw new Error("库里没有可用的管理员，先跑一次 db/init");
  adminToken = await signSession({
    sub: Number(adminRows[0].id),
    tv: Number(adminRows[0].token_version),
    role: "admin",
  });

  /* ------------------------------------------------------ 10 笔全成 */
  console.log("\n[10 个用户各充 100]");
  const ten = [];
  for (let i = 0; i < 10; i += 1) ten.push(await insertUser(`ok-${i}`));
  const items = ten.map(id => ({ user_id: id, amount: 100, reason: "验证批量充值", source: "recharge" }));
  const res = await call({ path: "/api/admin/balances/batch-adjust", body: { items }, token: adminToken });
  check("状态码 200", res.status === 200, res.body);
  check("count 为 10", res.body?.data?.count === 10, res.body?.data);
  check("total_amount 为 1000", near(res.body?.data?.total_amount ?? -1, 1000), res.body?.data);

  let balancesOk = true;
  for (let i = 0; i < 10; i += 1) {
    const account = await getAccount(ten[i]);
    const item = res.body?.data?.items?.[i];
    if (!near(Number(account.balance), 100)) balancesOk = false;
    if (item?.user_id !== ten[i]) balancesOk = false;
    if (!near(Number(item?.balance_after), 100)) balancesOk = false;
    if (!String(item?.ref).startsWith("rc-")) balancesOk = false;
  }
  check("逐条 balance_after 与库里余额都是 100，ref 以 rc- 开头", balancesOk, res.body?.data?.items);

  let txOk = true;
  for (const id of ten) {
    if ((await countTx(id)) !== 1) txOk = false;
  }
  check("每个用户 credit_transactions 正好 1 行（10 行）", txOk);

  /* ------------------------------------------------------ 回滚 */
  console.log("\n[混入一个不存在的用户，整批回滚]");
  const rollA = await insertUser("rb-a");
  const rollB = await insertUser("rb-b");
  // 给一个非零起点：若整批没有回滚，前两条会变成 577 / 588
  await setAccount(rollA, 77, 0, 0);
  await setAccount(rollB, 88, 0, 0);
  const ghostId = 2_147_000_000 + (stamp % 1_000_000);
  const beforeA = await getAccount(rollA);
  const beforeB = await getAccount(rollB);
  const beforeTxA = await countTx(rollA);
  const beforeTxB = await countTx(rollB);

  const badRes = await call({
    path: "/api/admin/balances/batch-adjust",
    body: {
      items: [
        { user_id: rollA, amount: 500, reason: "回滚验证", source: "recharge" },
        { user_id: rollB, amount: 500, reason: "回滚验证", source: "recharge" },
        { user_id: ghostId, amount: 500, reason: "回滚验证", source: "recharge" },
      ],
    },
    token: adminToken,
  });
  check("状态码 404", badRes.status === 404, badRes.body);
  check(
    "错误信息指出是第 3 条与用户 id",
    typeof badRes.body?.error === "string" &&
      badRes.body.error.includes("第 3 条") &&
      badRes.body.error.includes(String(ghostId)),
    badRes.body,
  );

  const afterA = await getAccount(rollA);
  const afterB = await getAccount(rollB);
  check(
    `前两条余额未变（${Number(beforeA.balance)} -> ${Number(afterA.balance)}，${Number(beforeB.balance)} -> ${Number(afterB.balance)}）`,
    near(Number(afterA.balance), Number(beforeA.balance)) &&
      near(Number(afterB.balance), Number(beforeB.balance)),
  );
  const afterTxA = await countTx(rollA);
  const afterTxB = await countTx(rollB);
  check(
    `前两条流水未增（${beforeTxA} -> ${afterTxA}，${beforeTxB} -> ${afterTxB}）`,
    afterTxA === beforeTxA && afterTxB === beforeTxB,
  );

  /* ------------------------------------------------- 入账先还授信 */
  console.log("\n[入账先冲抵已用授信]");
  const owed = await insertUser("owed");
  await clearTx(owed);
  await setAccount(owed, 0, 100, 30);
  const owedRes = await call({
    path: "/api/admin/balances/batch-adjust",
    body: { items: [{ user_id: owed, amount: 50, reason: "还授信", source: "recharge" }] },
    token: adminToken,
  });
  check("状态码 200", owedRes.status === 200, owedRes.body);
  const owedAccount = await getAccount(owed);
  check(
    `balance 20 / credit_used 0（实际 ${Number(owedAccount.balance)} / ${Number(owedAccount.credit_used)}）`,
    near(Number(owedAccount.balance), 20) && near(Number(owedAccount.credit_used), 0),
  );
  check(
    "balance_after 回的是 20",
    near(Number(owedRes.body?.data?.items?.[0]?.balance_after), 20),
    owedRes.body?.data,
  );

  /* ------------------------------------------------------ 边界输入 */
  console.log("\n[边界输入]");
  const empty = await call({
    path: "/api/admin/balances/batch-adjust",
    body: { items: [] },
    token: adminToken,
  });
  check("空数组回 400", empty.status === 400, empty.body);

  const tooManyItems = Array.from({ length: 201 }, (_, i) => ({
    user_id: 1,
    amount: 1,
    reason: "超限",
    source: "recharge",
  }));
  const tooMany = await call({
    path: "/api/admin/balances/batch-adjust",
    body: { items: tooManyItems },
    token: adminToken,
  });
  check("超过 200 条回 400", tooMany.status === 400, tooMany.body);

  const stringAmount = await call({
    path: "/api/admin/balances/batch-adjust",
    body: { items: [{ user_id: rollA, amount: "100", reason: "字符串金额" }] },
    token: adminToken,
  });
  check("amount 传字符串回 400", stringAmount.status === 400, stringAmount.body);
  check(
    "错误信息指出是第 1 条",
    typeof stringAmount.body?.error === "string" && stringAmount.body.error.includes("第 1 条"),
    stringAmount.body,
  );

  const zeroAmount = await call({
    path: "/api/admin/balances/batch-adjust",
    body: { items: [{ user_id: rollA, amount: 0, reason: "零金额" }] },
    token: adminToken,
  });
  check("amount 为 0 回 400", zeroAmount.status === 400, zeroAmount.body);

  const unauth = await call({
    path: "/api/admin/balances/batch-adjust",
    body: { items: [{ user_id: rollA, amount: 1, reason: "未登录" }] },
    token: null,
  });
  check("未登录回 401", unauth.status === 401, unauth.body);
} finally {
  // 只删本脚本造的用户与他们的流水
  if (userIds.length > 0) {
    await conn.query("DELETE FROM credit_transactions WHERE user_id IN (?)", [userIds]);
    await conn.query("DELETE FROM users WHERE id IN (?)", [userIds]);
  }
  await conn.end();
}

console.log(`\n通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
