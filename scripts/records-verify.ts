/**
 * #29 自助充值 与 #30 记录摄入/聚合 的进程内验证。
 *
 * 不起服务器：直接把路由 handler 拿来调，给一个带会话 cookie 的 Request。
 *   bun scripts/records-verify.ts
 *
 * 会自建一个测试用户与测试管理员会话，造 200 条记录 + 160 条账单散布在最近 14 天，
 * 跑完把测试用户相关的行全部删掉（只按 user_id 删，不动别人的数据）。
 */
import mysql, { type ResultSetHeader } from "mysql2/promise";

process.env.RECORDS_CALLBACK_SECRET = `verify-records-${Date.now()}`;
process.env.RECHARGE_CALLBACK_SECRET = `verify-recharge-${Date.now()}`;

import { signSession } from "../src/lib/auth";

const RECORDS_SECRET = process.env.RECORDS_CALLBACK_SECRET;
const RECHARGE_SECRET = process.env.RECHARGE_CALLBACK_SECRET;
const conn = await mysql.createConnection(
  process.env.DATABASE_URL ?? "mysql://tokenmp:tokenmp-dev@127.0.0.1:3307/tokenmp",
);

const stamp = Date.now();
const userName = `t-verify-${stamp}`;

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function near(a: number, b: number, tolerance = 1e-6) {
  return Math.abs(a - b) <= tolerance;
}

async function call(
  handler: unknown,
  options: {
    method?: string;
    path: string;
    body?: unknown;
    token?: string | null;
    headers?: Record<string, string>;
  },
) {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token) headers.cookie = `tokenmp_session=${options.token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const request = new Request(`http://localhost:6789${options.path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const response = await (handler as (event: unknown) => Promise<Response>)({ request, params: {} });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 不是 JSON 就保留原文
  }
  return { status: response.status, body: parsed as any };
}

/* --------------------------------------------------------------- 造测试数据 */

const [adminRows] = (await conn.query(
  "SELECT id, token_version, role FROM users WHERE role = 'admin' AND status = 1 LIMIT 1",
)) as [Array<{ id: number; token_version: number; role: string }>, unknown];
if (!adminRows?.[0]) throw new Error("库里没有可用的管理员账号");
const adminToken = await signSession({
  sub: adminRows[0].id,
  tv: adminRows[0].token_version,
  role: adminRows[0].role,
});

const [created] = (await conn.query(
  `INSERT INTO users (name, email, password_hash, role, status, credit_limit, balance, credit_used, token_version, source, created_at, updated_at)
   VALUES (?, ?, 'x', 'user', 1, 0, 0, 0, 0, 'local', NOW(3), NOW(3))`,
  [userName, `${userName}@example.com`],
)) as [ResultSetHeader, unknown];
const userId = created.insertId;
const userToken = await signSession({ sub: userId, tv: 0, role: "user" });

// 校验账单金额落在哪个口袋的对照小号，用到时才建；清理时按它删
let pocketUserId = 0;

const MODELS = ["vfy-model-alpha", "vfy-model-beta", "vfy-model-gamma"];
const TOTAL_RECORDS = 200;
const now = Date.now();
const startOfTodayUtc = Date.UTC(
  new Date(now).getUTCFullYear(),
  new Date(now).getUTCMonth(),
  new Date(now).getUTCDate(),
);

type GeneratedRecord = Record<string, unknown>;
type GeneratedBilling = Record<string, unknown>;

const recordPayload: GeneratedRecord[] = [];
const billingPayload: GeneratedBilling[] = [];

let expectedTokens = 0;
let expectedRevenue = 0;
let expectedErrors = 0;
const expectedByDay = new Map<string, { requests: number; tokens: number; revenue: number }>();

for (let i = 0; i < TOTAL_RECORDS; i += 1) {
  const offsetMinutes = i % (13 * 24 * 60);
  const createdAt = new Date(now - offsetMinutes * 60_000);
  const day = createdAt.toISOString().slice(0, 10);
  const model = MODELS[i % MODELS.length]!;
  const isError = i % 5 === 0;
  const prompt = 100 + ((i * 37) % 900);
  const completion = 20 + ((i * 13) % 300);
  const total = prompt + completion;
  const requestId = `vfy-req-${stamp}-${i}`;

  recordPayload.push({
    request_id: requestId,
    user_id: userId,
    api_key_id: 900_000 + (i % 3),
    model,
    served_model: model,
    entry: i % 4 === 0 ? "messages" : "chat",
    stream: i % 2 === 0,
    channel: "vfy-channel",
    channel_type: "openai",
    base_url: "https://example.invalid/v1",
    status: isError ? "error" : "success",
    http_status: isError ? 502 : 200,
    error_code: isError ? "upstream_timeout" : null,
    panel_message: isError ? "上游超时" : null,
    attempts: isError ? 2 : 1,
    retried: isError,
    user_agent: "verify-agent/1.0",
    reasoning_effort: null,
    latency_ms: 500 + (i % 2000),
    ttfb_ms: 100 + (i % 300),
    tps: 12.5,
    prompt_tokens: prompt,
    completion_tokens: completion,
    cache_read_tokens: i % 100,
    cache_write_tokens: 0,
    total_tokens: total,
    created_at: createdAt.toISOString(),
  });

  expectedTokens += total;
  const dayBucket = expectedByDay.get(day) ?? { requests: 0, tokens: 0, revenue: 0 };
  dayBucket.requests += 1;
  dayBucket.tokens += total;
  expectedByDay.set(day, dayBucket);

  if (isError) {
    expectedErrors += 1;
    continue;
  }

  const cost = (i % 50) + 1;
  const costAmount = cost / 1000;
  const revenueAmount = (cost * 3) / 2000;
  expectedRevenue += revenueAmount;
  dayBucket.revenue += revenueAmount;

  billingPayload.push({
    request_id: requestId,
    user_id: userId,
    api_key_id: 900_000 + (i % 3),
    channel_name: "vfy-channel",
    owner_user_id: null,
    entry: i % 4 === 0 ? "messages" : "chat",
    model,
    stream: i % 2 === 0,
    usage_source: "upstream",
    charge_mode: "token",
    cost_multiplier: 1,
    cost_amount: costAmount,
    revenue_multiplier: 1.5,
    revenue_amount: revenueAmount,
    owner_credit_amount: 0,
    currency: "CNY",
    billing_mode: "pay_as_you_go",
    ledger: i % 2 === 0 ? "balance" : "quota",
    latency_ms: 500 + (i % 2000),
    http_status: 200,
    attempts: 1,
    retried: false,
    status: "success",
    prompt_tokens: prompt,
    completion_tokens: completion,
    cache_read_tokens: i % 100,
    cache_write_tokens: 0,
    total_tokens: total,
    created_at: createdAt.toISOString(),
  });
}
const expectedBillingCount = billingPayload.length;

/* --------------------------------------------------------------- 动态导入 */

const { POST: rechargePost, GET: rechargeGet } = await import("../src/routes/api/user/recharge");
const { POST: callbackPost } = await import("../src/routes/api/internal/recharge-callback");
const { POST: ingestPost } = await import("../src/routes/api/internal/records");
const { GET: userUsageGet } = await import("../src/routes/api/user/usage");
const { GET: userRecordsGet } = await import("../src/routes/api/user/request-records");
const { GET: userFiltersGet } = await import("../src/routes/api/user/request-records/filters");
const { GET: userBillingGet } = await import("../src/routes/api/user/billing-records");
const { GET: adminRecordsGet } = await import("../src/routes/api/admin/request-records");
const { GET: adminFiltersGet } = await import("../src/routes/api/admin/request-records/filters");
const { GET: adminBillingGet } = await import("../src/routes/api/admin/billing-records");
const { GET: adminSummaryGet } = await import("../src/routes/api/admin/dashboard/summary");
const { GET: adminUsageGet } = await import("../src/routes/api/admin/dashboard/usage");
const { GET: adminDashboardGet } = await import("../src/routes/api/admin/dashboard");

const recordsHeaders = { "x-callback-secret": RECORDS_SECRET! };
const rechargeHeaders = { "x-callback-secret": RECHARGE_SECRET! };

try {
  /* -------------------------------------------------------- #29 充值与回调 */

  console.log("\n#29 自助充值");

  const badAmounts: Array<[string, unknown]> = [
    ["负数", -5],
    ["零", 0],
    ["字符串", "100"],
    ["缺失", undefined],
    ["超范围", 10_000_000],
  ];
  for (const [label, amount] of badAmounts) {
    const res = await call(rechargePost, {
      method: "POST",
      path: "/api/user/recharge",
      token: userToken,
      body: amount === undefined ? {} : { amount },
    });
    check(`下单金额非法（${label}）回 400`, res.status === 400, `status=${res.status}`);
  }

  const badChannel = await call(rechargePost, {
    method: "POST",
    path: "/api/user/recharge",
    token: userToken,
    body: { amount: 100, channel: "bad channel!" },
  });
  check("渠道名非法回 400", badChannel.status === 400, `status=${badChannel.status}`);

  const order1 = await call(rechargePost, {
    method: "POST",
    path: "/api/user/recharge",
    token: userToken,
    body: { amount: 100 },
  });
  check("下单成功回 201", order1.status === 201, `status=${order1.status}`);
  check("下单返回 pending 单号", order1.body?.data?.status === "pending" && !!order1.body?.data?.order_no);
  const orderNo1 = order1.body?.data?.order_no as string;

  const myOrders = await call(rechargeGet, { path: "/api/user/recharge?page=1&size=10", token: userToken });
  check("我的充值单列表含刚下单的单", myOrders.status === 200 && myOrders.body.total >= 1);
  check(
    "列表里单子状态是 pending",
    (myOrders.body.items as any[]).some(item => item.order_no === orderNo1 && item.status === "pending"),
  );

  const noSecret = await call(callbackPost, {
    method: "POST",
    path: "/api/internal/recharge-callback",
    body: { order_no: orderNo1, status: "paid" },
  });
  check("回调缺共享密钥回 401", noSecret.status === 401, `status=${noSecret.status}`);

  const wrongSecret = await call(callbackPost, {
    method: "POST",
    path: "/api/internal/recharge-callback",
    headers: { "x-callback-secret": "wrong" },
    body: { order_no: orderNo1, status: "paid" },
  });
  check("回调共享密钥不对回 403", wrongSecret.status === 403, `status=${wrongSecret.status}`);

  const unknownOrder = await call(callbackPost, {
    method: "POST",
    path: "/api/internal/recharge-callback",
    headers: rechargeHeaders,
    body: { order_no: "rc-does-not-exist", status: "paid" },
  });
  check("单号不存在回 404", unknownOrder.status === 404, `status=${unknownOrder.status}`);

  const paid1 = await call(callbackPost, {
    method: "POST",
    path: "/api/internal/recharge-callback",
    headers: rechargeHeaders,
    body: { order_no: orderNo1, external_no: "ext-1", status: "paid", amount: 100 },
  });
  check("首次 paid 回调回 200 且非重复", paid1.status === 200 && paid1.body.already === false, JSON.stringify(paid1.body));

  const [order1Row] = (await conn.query(
    "SELECT status, paid_at, external_no, credit_transaction_id FROM recharge_orders WHERE order_no = ?",
    [orderNo1],
  )) as [any[], unknown];
  check(
    "单子推进到 paid 并写上外部号与流水",
    order1Row[0]?.status === "paid" &&
      order1Row[0]?.paid_at !== null &&
      order1Row[0]?.external_no === "ext-1" &&
      order1Row[0]?.credit_transaction_id !== null,
    JSON.stringify(order1Row[0]),
  );

  const [balanceAfterPaid] = (await conn.query("SELECT balance FROM users WHERE id = ?", [userId])) as [
    any[],
    unknown,
  ];
  check("余额加上了 100", near(Number(balanceAfterPaid[0].balance), 100), String(balanceAfterPaid[0].balance));

  const repeat = await call(callbackPost, {
    method: "POST",
    path: "/api/internal/recharge-callback",
    headers: rechargeHeaders,
    body: { order_no: orderNo1, external_no: "ext-1", status: "paid", amount: 100 },
  });
  check("重复回调回 {ok:true, already:true}", repeat.status === 200 && repeat.body.already === true, JSON.stringify(repeat.body));

  const [balanceAfterRepeat] = (await conn.query("SELECT balance FROM users WHERE id = ?", [userId])) as [
    any[],
    unknown,
  ];
  const [txCount] = (await conn.query(
    "SELECT COUNT(*) n FROM credit_transactions WHERE user_id = ? AND ref_id = ?",
    [userId, orderNo1],
  )) as [any[], unknown];
  check(
    "重复回调没有重复入账",
    near(Number(balanceAfterRepeat[0].balance), 100) && Number(txCount[0].n) === 1,
    `balance=${balanceAfterRepeat[0].balance} tx=${txCount[0].n}`,
  );

  const order2 = await call(rechargePost, {
    method: "POST",
    path: "/api/user/recharge",
    token: userToken,
    body: { amount: 50 },
  });
  const orderNo2 = order2.body?.data?.order_no as string;
  const failed = await call(callbackPost, {
    method: "POST",
    path: "/api/internal/recharge-callback",
    headers: rechargeHeaders,
    body: { order_no: orderNo2, status: "failed" },
  });
  const [order2Row] = (await conn.query("SELECT status, paid_at, credit_transaction_id FROM recharge_orders WHERE order_no = ?", [
    orderNo2,
  ])) as [any[], unknown];
  const [balanceAfterFailed] = (await conn.query("SELECT balance FROM users WHERE id = ?", [userId])) as [any[], unknown];
  check(
    "failed 回调只改状态不入账",
    failed.status === 200 &&
      order2Row[0]?.status === "failed" &&
      order2Row[0]?.credit_transaction_id === null &&
      near(Number(balanceAfterFailed[0].balance), 100),
    `status=${order2Row[0]?.status} balance=${balanceAfterFailed[0].balance}`,
  );

  const paidAfterFailed = await call(callbackPost, {
    method: "POST",
    path: "/api/internal/recharge-callback",
    headers: rechargeHeaders,
    body: { order_no: orderNo2, status: "paid" },
  });
  const [balanceAfterLatePay] = (await conn.query("SELECT balance FROM users WHERE id = ?", [userId])) as [
    any[],
    unknown,
  ];
  check(
    "非 pending 的单再收 paid 也算重复，不入账",
    paidAfterFailed.body?.already === true && near(Number(balanceAfterLatePay[0].balance), 100),
    `already=${paidAfterFailed.body?.already} balance=${balanceAfterLatePay[0].balance}`,
  );

  /* ------------------------------------------------------- #30 摄入与查询 */

  console.log("\n#30 记录摄入");

  const noSecretIngest = await call(ingestPost, {
    method: "POST",
    path: "/api/internal/records",
    body: { records: [] },
  });
  check("摄入缺共享密钥回 401", noSecretIngest.status === 401, `status=${noSecretIngest.status}`);

  const badShape = await call(ingestPost, {
    method: "POST",
    path: "/api/internal/records",
    headers: recordsHeaders,
    body: { records: {} },
  });
  check("records 不是数组回 400", badShape.status === 400, `status=${badShape.status}`);

  const first = await call(ingestPost, {
    method: "POST",
    path: "/api/internal/records",
    headers: recordsHeaders,
    body: { records: recordPayload, billing: billingPayload },
  });
  check(
    `首次摄入 inserted=${TOTAL_RECORDS + expectedBillingCount}`,
    first.status === 200 && first.body.inserted === TOTAL_RECORDS + expectedBillingCount && first.body.skipped === 0,
    JSON.stringify(first.body),
  );

  const second = await call(ingestPost, {
    method: "POST",
    path: "/api/internal/records",
    headers: recordsHeaders,
    body: { records: recordPayload, billing: billingPayload },
  });
  check(
    "重复提交整批不重复插入",
    second.status === 200 && second.body.inserted === 0 && second.body.skipped === TOTAL_RECORDS + expectedBillingCount,
    JSON.stringify(second.body),
  );

  const third = await call(ingestPost, {
    method: "POST",
    path: "/api/internal/records",
    headers: recordsHeaders,
    body: {
      records: [recordPayload[0], { request_id: `vfy-req-${stamp}-extra`, user_id: userId, model: MODELS[0], status: "success" }],
    },
  });
  check(
    "半新半旧一批：只插新的那条",
    third.status === 200 && third.body.inserted === 1 && third.body.skipped === 1,
    JSON.stringify(third.body),
  );

  const [dbCounts] = (await conn.query(
    `SELECT
       (SELECT COUNT(*) FROM request_records WHERE user_id = ?) AS records,
       (SELECT COUNT(*) FROM billing_records WHERE user_id = ?) AS billing`,
    [userId, userId],
  )) as [any[], unknown];
  check(
    `库里 request_records=${TOTAL_RECORDS + 1} billing=${expectedBillingCount}`,
    Number(dbCounts[0].records) === TOTAL_RECORDS + 1 && Number(dbCounts[0].billing) === expectedBillingCount,
    JSON.stringify(dbCounts[0]),
  );

  /* ------------------------------------------------------------- 查询聚合 */

  console.log("\n#30 查询与聚合");

  const usage = await call(userUsageGet, { path: "/api/user/usage?days=14", token: userToken });
  const series = (usage.body?.data?.series ?? []) as Array<{
    date: string;
    requests: number;
    tokens: number;
    revenue: number;
    models: Array<{ model: string; requests: number; tokens: number; revenue: number }>;
  }>;
  const seriesRequests = series.reduce((sum, p) => sum + p.requests, 0);
  const seriesTokens = series.reduce((sum, p) => sum + p.tokens, 0);
  const seriesRevenue = series.reduce((sum, p) => sum + p.revenue, 0);
  check("用量序列长度等于 days", series.length === 14, `len=${series.length}`);
  check(
    `用量 requests 合计 ${seriesRequests} == ${TOTAL_RECORDS + 1}`,
    seriesRequests === TOTAL_RECORDS + 1,
  );
  check("用量 tokens 合计对得上", seriesTokens === expectedTokens, `${seriesTokens} vs ${expectedTokens}`);
  check(
    `用量 revenue 合计约 ${expectedRevenue.toFixed(6)}`,
    near(seriesRevenue, expectedRevenue, 1e-4),
    `${seriesRevenue} vs ${expectedRevenue}`,
  );

  let dayRevenueMatches = true;
  let modelRevenueMatches = true;
  for (const point of series) {
    const modelSum = point.models.reduce((sum, m) => sum + m.revenue, 0);
    if (!near(modelSum, point.revenue, 1e-6)) modelRevenueMatches = false;
    const expected = expectedByDay.get(point.date);
    if (expected && !near(point.revenue, expected.revenue, 1e-4)) dayRevenueMatches = false;
  }
  check("每天的模型收入之和等于当天收入", modelRevenueMatches);
  check("每天的 revenue 与造数逐日吻合", dayRevenueMatches);

  const usageBadDays = await call(userUsageGet, { path: "/api/user/usage?days=0", token: userToken });
  check("days=0 回 400", usageBadDays.status === 400, `status=${usageBadDays.status}`);

  const modelAlpha = MODELS[0]!;
  const filteredByModel = await call(userRecordsGet, {
    path: `/api/user/request-records?page=1&size=5&model=${modelAlpha}`,
    token: userToken,
  });
  const modelAlphaTotal = Math.ceil((TOTAL_RECORDS + 1) / MODELS.length) + 1; // 200 条里 alpha 占 67，extra 也是 alpha
  check(
    `按模型筛选 alpha total=${modelAlphaTotal}`,
    filteredByModel.body.total === modelAlphaTotal && filteredByModel.body.items.length === 5,
    `total=${filteredByModel.body.total} items=${filteredByModel.body.items.length}`,
  );

  const filteredByStatus = await call(userRecordsGet, {
    path: "/api/user/request-records?page=1&size=100&status=error",
    token: userToken,
  });
  check(
    `按状态筛选 error total=${expectedErrors}`,
    filteredByStatus.body.total === expectedErrors,
    `total=${filteredByStatus.body.total}`,
  );

  const startRange = new Date(now - 25 * 3600_000).toISOString();
  // end 给一点余量，把摄入时才生成 created_at 的那条额外记录也算进来
  const endRange = new Date(Date.now() + 60_000).toISOString();
  const expectedLast24h =
    recordPayload.filter(r => new Date(r.created_at as string).getTime() >= now - 25 * 3600_000).length + 1;
  const filteredByTime = await call(
    userRecordsGet,
    {
      path: `/api/user/request-records?page=1&size=100&start=${encodeURIComponent(startRange)}&end=${encodeURIComponent(endRange)}`,
      token: userToken,
    },
  );
  check(
    `按时间范围筛选 total=${expectedLast24h}`,
    filteredByTime.body.total === expectedLast24h,
    `total=${filteredByTime.body.total}`,
  );

  const keywordRes = await call(userRecordsGet, {
    path: `/api/user/request-records?keyword=vfy-req-${stamp}-12`,
    token: userToken,
  });
  check("keyword 模糊匹配有结果", keywordRes.body.total >= 1, `total=${keywordRes.body.total}`);

  const userFilters = await call(userFiltersGet, { path: "/api/user/request-records/filters", token: userToken });
  check(
    "我的筛选项模型集合正确",
    JSON.stringify(userFilters.body?.data?.models) === JSON.stringify([...MODELS].sort()),
    JSON.stringify(userFilters.body?.data?.models),
  );
  check(
    "我的筛选项 user_agents 含 verify-agent/1.0",
    (userFilters.body?.data?.user_agents ?? []).includes("verify-agent/1.0"),
  );

  const userBilling = await call(userBillingGet, { path: "/api/user/billing-records?page=1&size=20", token: userToken });
  check(
    `我的账单 total=${expectedBillingCount}`,
    userBilling.body.total === expectedBillingCount && userBilling.body.items.length === 20,
    `total=${userBilling.body.total}`,
  );
  check(
    "账单带 quota_paid / balance_paid",
    typeof userBilling.body.items[0]?.quota_paid === "number" && typeof userBilling.body.items[0]?.balance_paid === "number",
  );

  // 上面那条只断言类型，两个字段对调也照样绿 —— 它证不了装的是哪个口袋的钱。
  // 这里另起一个小号：主测试用户没有订阅，账单全走余额，改它会牵动这一节下面
  // 一串计数。小号带一笔 3 元的生效订阅，造两笔账单：3 元那笔正好吃满订阅额度，
  // 0.5 元那笔订阅额度不够、整笔走余额，两笔分别落进两个口袋。
  const [pocketUser] = (await conn.query(
    `INSERT INTO users (name, email, password_hash, role, status, credit_limit, balance, credit_used, token_version, source, created_at, updated_at)
     VALUES (?, ?, 'x', 'user', 1, 50, 0, 0, 0, 'local', NOW(3), NOW(3))`,
    [`${userName}-pocket`, `${userName}-pocket@example.com`],
  )) as [ResultSetHeader, unknown];
  pocketUserId = pocketUser.insertId;
  const pocketToken = await signSession({ sub: pocketUserId, tv: 0, role: "user" });

  await conn.query(
    `INSERT INTO subscriptions (user_id, plan_id, amount, quota_kind, quota_limit, quota_used,
                                period_start, period_end, status, created_at, updated_at)
     VALUES (?, 2, 3, 'money', 3, 0, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 DAY), 'active', NOW(3), NOW(3))`,
    [pocketUserId],
  );

  const pocketQuotaId = `vfy-pocket-${stamp}-quota`;
  const pocketBalanceId = `vfy-pocket-${stamp}-balance`;
  const pocketIngest = await call(ingestPost, {
    method: "POST",
    path: "/api/internal/records",
    headers: recordsHeaders,
    body: {
      // 请求体里给的 ledger 一律被丢掉（见 src/lib/records.ts 的摄入路径），
      // 这里特意给反的：断言能过就说明取的是本机判定的口袋，不是入参
      billing: [
        { request_id: pocketQuotaId, user_id: pocketUserId, model: MODELS[0], revenue_amount: 3, ledger: "balance" },
        { request_id: pocketBalanceId, user_id: pocketUserId, model: MODELS[0], revenue_amount: 0.5, ledger: "quota" },
      ],
    },
  });
  check("口袋对照的账单摄入成功", pocketIngest.status === 200 && pocketIngest.body.inserted === 2, JSON.stringify(pocketIngest.body));

  const pocketLedgers = (await conn.query(
    "SELECT request_id, ledger FROM billing_records WHERE user_id = ? ORDER BY request_id",
    [pocketUserId],
  )) as [Array<{ request_id: string; ledger: string | null }>, unknown];
  check(
    "库里的 ledger 与造数一致（3 元走订阅额度、0.5 元走余额）",
    JSON.stringify(pocketLedgers[0].map(row => [row.request_id, row.ledger])) ===
      JSON.stringify([
        [pocketBalanceId, "balance"],
        [pocketQuotaId, "quota"],
      ]),
    JSON.stringify(pocketLedgers[0]),
  );

  const pocketBilling = await call(userBillingGet, {
    path: `/api/user/billing-records?page=1&size=10&request_id=vfy-pocket-${stamp}`,
    token: pocketToken,
  });
  const pocketRow = (id: string) =>
    (pocketBilling.body.items as any[] | undefined)?.find(item => item.request_id === id);
  const quotaRow = pocketRow(pocketQuotaId);
  const balanceRow = pocketRow(pocketBalanceId);
  check(
    "ledger='quota' 的账单：quota_paid = 该笔 revenue，balance_paid = 0",
    !!quotaRow && near(quotaRow.quota_paid, 3) && quotaRow.balance_paid === 0 && near(quotaRow.revenue_amount, 3),
    JSON.stringify(quotaRow),
  );
  check(
    "ledger='balance' 的账单：balance_paid = 该笔 revenue，quota_paid = 0",
    !!balanceRow && near(balanceRow.balance_paid, 0.5) && balanceRow.quota_paid === 0 && near(balanceRow.revenue_amount, 0.5),
    JSON.stringify(balanceRow),
  );
  const userBillingFree = await call(userBillingGet, {
    path: "/api/user/billing-records?charge=free",
    token: userToken,
  });
  check("charge=free 没有条目", userBillingFree.body.total === 0, `total=${userBillingFree.body.total}`);

  const globalRevenueWindow = new Date(startOfTodayUtc - 13 * 86_400_000);
  const [globalUsageExpected] = (await conn.query(
    `SELECT
       (SELECT COUNT(*) FROM request_records WHERE created_at >= ?) AS requests,
       (SELECT COALESCE(SUM(revenue_amount), 0) FROM billing_records WHERE created_at >= ?) AS revenue`,
    [globalRevenueWindow, globalRevenueWindow],
  )) as [any[], unknown];

  const adminUsage = await call(adminUsageGet, { path: "/api/admin/dashboard/usage?days=14&foo=1", token: adminToken });
  const adminUsageRequests = (adminUsage.body.items as any[]).reduce((sum, item) => sum + item.requests, 0);
  const adminUsageRevenue = (adminUsage.body.items as any[]).reduce((sum, item) => sum + item.revenue, 0);
  check(
    `admin usage 总量与库一致（${adminUsageRequests} 请求）`,
    adminUsageRequests === Number(globalUsageExpected[0].requests),
    `${adminUsageRequests} vs ${globalUsageExpected[0].requests}`,
  );
  check(
    "admin usage 收入与库一致",
    near(adminUsageRevenue, Number(globalUsageExpected[0].revenue), 1e-4),
    `${adminUsageRevenue} vs ${globalUsageExpected[0].revenue}`,
  );
  check("admin usage total == days", adminUsage.body.total === 14, `total=${adminUsage.body.total}`);

  const adminUsageFallback = await call(adminUsageGet, { path: "/api/admin/dashboard/usage?days=999", token: adminToken });
  check("admin usage days 越界回落到 7", adminUsageFallback.body.total === 7, `total=${adminUsageFallback.body.total}`);

  const [summaryExpected] = (await conn.query(
    `SELECT
       (SELECT COUNT(*) FROM request_records WHERE created_at >= NOW(3) - INTERVAL 24 HOUR) AS requests,
       (SELECT COUNT(*) FROM request_records WHERE created_at >= NOW(3) - INTERVAL 24 HOUR AND status = 'success') AS success,
       (SELECT COALESCE(SUM(cost_amount), 0) FROM billing_records WHERE created_at >= NOW(3) - INTERVAL 24 HOUR) AS cost,
       (SELECT COALESCE(SUM(revenue_amount), 0) FROM billing_records WHERE created_at >= NOW(3) - INTERVAL 24 HOUR) AS revenue`,
  )) as [any[], unknown];
  const [lowExpected] = (await conn.query(
    "SELECT COUNT(*) n FROM users WHERE status = 1 AND (balance + (credit_limit - credit_used)) <= 0",
  )) as [any[], unknown];

  const summary = await call(adminSummaryGet, { path: "/api/admin/dashboard/summary", token: adminToken });
  const last = summary.body?.data?.last_24h;
  check(
    `概览 24h 请求数 ${last?.requests} == 库 ${summaryExpected[0].requests}`,
    last?.requests === Number(summaryExpected[0].requests),
  );
  check(
    `概览 24h 成功数 ${last?.success} == 库 ${summaryExpected[0].success}`,
    last?.success === Number(summaryExpected[0].success),
  );
  check(
    "概览成功率等于 success / requests",
    last?.requests > 0 ? near(last.success_rate, (last.success / last.requests) * 100, 0.01) : last?.success_rate === 0,
    `${last?.success_rate}`,
  );
  check(
    "概览 24h 成本与收入与库一致",
    near(last?.cost ?? -1, Number(summaryExpected[0].cost), 1e-4) &&
      near(last?.revenue ?? -1, Number(summaryExpected[0].revenue), 1e-4),
    `cost=${last?.cost} revenue=${last?.revenue}`,
  );
  check(
    `概览余额不足用户 ${summary.body?.data?.low_balance_users} == 库 ${lowExpected[0].n}`,
    summary.body?.data?.low_balance_users === Number(lowExpected[0].n),
  );

  const adminRecords = await call(adminRecordsGet, {
    path: `/api/admin/request-records?user_id=${userId}&size=100`,
    token: adminToken,
  });
  check(
    `admin 调用记录按 user_id 筛选 total=${TOTAL_RECORDS + 1}`,
    adminRecords.body.total === TOTAL_RECORDS + 1,
    `total=${adminRecords.body.total}`,
  );

  const adminBilling = await call(adminBillingGet, {
    path: `/api/admin/billing-records?user_id=${userId}&size=100`,
    token: adminToken,
  });
  check(
    `admin 计费流水按 user_id 筛选 total=${expectedBillingCount}`,
    adminBilling.body.total === expectedBillingCount,
    `total=${adminBilling.body.total}`,
  );

  const adminFilters = await call(adminFiltersGet, { path: "/api/admin/request-records/filters", token: adminToken });
  check(
    "admin 筛选项包含测试模型",
    MODELS.every(model => (adminFilters.body?.data?.models ?? []).includes(model)),
  );

  const combined = await call(adminDashboardGet, { path: "/api/admin/dashboard?days=7", token: adminToken });
  check(
    "合并入口同时返回 summary 与 usage",
    !!combined.body?.data?.summary?.last_24h && Array.isArray(combined.body?.data?.usage?.items),
  );

  const anon = await call(userRecordsGet, { path: "/api/user/request-records" });
  check("未登录读记录回 401", anon.status === 401, `status=${anon.status}`);
  const nonAdmin = await call(adminSummaryGet, { path: "/api/admin/dashboard/summary", token: userToken });
  check("普通用户读管理端回 403", nonAdmin.status === 403, `status=${nonAdmin.status}`);
} finally {
  // 只按 user_id 删自己造的行，不用宽泛条件
  await conn.query("DELETE FROM request_records WHERE user_id = ?", [userId]);
  await conn.query("DELETE FROM billing_records WHERE user_id = ?", [userId]);
  await conn.query("DELETE FROM recharge_orders WHERE user_id = ?", [userId]);
  await conn.query("DELETE FROM credit_transactions WHERE user_id = ?", [userId]);
  await conn.query("DELETE FROM users WHERE id = ?", [userId]);

  if (pocketUserId) {
    await conn.query("DELETE FROM billing_records WHERE user_id = ?", [pocketUserId]);
    await conn.query("DELETE FROM credit_transactions WHERE user_id = ?", [pocketUserId]);
    await conn.query("DELETE FROM subscriptions WHERE user_id = ?", [pocketUserId]);
    await conn.query("DELETE FROM users WHERE id = ?", [pocketUserId]);
  }
  await conn.end();
}

console.log(`\n通过 ${passed}，失败 ${failures.length}`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(failures.length ? 1 : 0);
