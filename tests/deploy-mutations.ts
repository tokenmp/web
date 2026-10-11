/**
 * 变异测试（异常输入 / fuzzing）——打真实 HTTP 的生产构建。
 *
 * 目标是这次新做的四组接口：用户管理、余额账本、API 密钥、套餐与订阅。
 * 每一项都发真实请求，状态码以 openapi.yaml 为准，不符就记一条失败。
 *
 * 前提：服务已经在 http://127.0.0.1:6789 跑着（生产构建），本文件不重启它。
 *
 *   bun tests/deploy-mutations.ts
 *
 * 所有测试数据用 mut- 前缀 + 时间戳，只清本次 stamp 造出来的记录。脚本不会
 * 触碰别人的数据，也绝不按宽泛的 LIKE 'mut-%' 删。
 */
import mysql from "mysql2/promise";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:6789";
const DB_URL = process.env.DATABASE_URL ?? "mysql://tokenmp:tokenmp-dev@127.0.0.1:3307/tokenmp";
const stamp = Date.now();
const password = "mut-Password-123";
const adminEmail = `mut-admin-${stamp}@example.com`;
const userAEmail = `mut-usera-${stamp}@example.com`;
const userBEmail = `mut-userb-${stamp}@example.com`;
const planName = `mut-套餐-${stamp}`;

const conn = await mysql.createConnection(DB_URL);

let pass = 0;
let fail = 0;
const failures: string[] = [];
const notes: string[] = [];
const fiveHundreds: { method: string; path: string; req: string; res: string }[] = [];

function short(v: unknown, n = 200) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s === undefined ? "" : s.length > n ? `${s.slice(0, n)}…` : s;
}

function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    return;
  }
  fail++;
  const line = `${label}${detail === undefined ? "" : ` → ${short(detail)}`}`;
  failures.push(line);
  console.log(`  ✗ ${line}`);
}

function note(label: string, detail?: unknown) {
  const line = `${label}${detail === undefined ? "" : ` → ${short(detail)}`}`;
  notes.push(line);
}

type Res = { status: number; body: any; text: string; headers: Headers };

/** 带 cookie 的客户端。cookie 手动接管，与 tests/deploy-flow.ts 一致。 */
function makeClient() {
  let cookie = "";
  async function send(
    method: string,
    path: string,
    opts: {
      json?: boolean;
      payload?: unknown;
      body?: any;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    } = {},
  ): Promise<Res> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (cookie) headers.cookie = cookie;
    let body = opts.body;
    if (opts.json) {
      headers["content-type"] = headers["content-type"] ?? "application/json";
      body = JSON.stringify(opts.payload);
    }
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, { method, headers, body, redirect: "manual", signal: opts.signal });
    } catch (e) {
      // 连接层被拒（超长 URL、拒绝连接等）：不抛，交给断言去判
      return { status: 0, body: String(e), text: String(e), headers: new Headers() };
    }
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(";")[0];
      if (pair.startsWith("tokenmp_session=")) cookie = pair;
    }
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* HTML 错误页 */
    }
    if (res.status >= 500) {
      fiveHundreds.push({
        method,
        path,
        req: typeof body === "string" ? short(body) : "<无请求体>",
        res: short(text, 300),
      });
    }
    return { status: res.status, body: parsed, text, headers: res.headers };
  }
  return {
    send,
    get: (p: string, signal?: AbortSignal) => send("GET", p, { signal }),
    post: (p: string, payload?: unknown, signal?: AbortSignal) => send("POST", p, { json: true, payload, signal }),
    put: (p: string, payload?: unknown) => send("PUT", p, { json: true, payload }),
    del: (p: string, signal?: AbortSignal) => send("DELETE", p, { signal }),
    set: (c: string) => {
      cookie = c;
    },
    cookie: () => cookie,
  };
}

/** 状态码断言：期望里写 openapi 允许的几个码 */
function expectStatus(label: string, r: Res, ...allowed: number[]) {
  const ok = allowed.includes(r.status);
  const detail = ok ? undefined : r.status >= 500 ? `响应：${short(r.text, 180)}` : `响应：${short(r.text, 120)}`;
  check(`${label}【期望 ${allowed.join("/")}，实际 ${r.status}】`, ok, detail);
}

/** 只要能确认「没崩成 500」就够的宽松断言 */
function expectNo5xx(label: string, r: Res) {
  check(`${label}【期望非 5xx，实际 ${r.status}】`, r.status < 500, short(r.text, 180));
}

async function rows<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const [r] = (await conn.query(sql, params)) as any;
  return r as T[];
}

async function scalar(sql: string, params: any[] = []): Promise<any> {
  const r = await rows(sql, params);
  return r[0] ? Object.values(r[0])[0] : undefined;
}

const userIds = new Set<number>();
const planIds = new Set<number>();

const admin = makeClient();
const userA = makeClient();
const userB = makeClient();
const anon = makeClient();

const BOUND = `mut-bound-${stamp}`;
const CONC = `mut-conc-${stamp}`;
const SUB = `mut-sub-${stamp}`;
const ABORT = `mut-abort-${stamp}`;
const PCT = `mut-pct%${stamp}`;

let adminId = 0;
let userAId = 0;
let userBId = 0;
let planId = 0;
let boundId = 0;
let concId = 0;
let subId = 0;
let abortId = 0;
let pctId = 0;
let scratchId = 0;
let scratchPlanId = 0;
let keyBId = 0;
let keyBPlain = "";

try {
  /* ------------------------------------------------------------------ 准备 */
  console.log("\n【准备】建管理员、两个业务用户与一个订阅套餐");
  const reg = await admin.post("/api/auth/register", { email: adminEmail, password, name: `mut-admin-${stamp}` });
  expectStatus("注册管理员", reg, 201);
  adminId = reg.body?.user?.id;
  userIds.add(adminId);
  await conn.query("UPDATE users SET role = 'admin' WHERE id = ?", [adminId]);
  await admin.post("/api/auth/login", { email: adminEmail, password });

  const mk = async (name: string, email: string, client: ReturnType<typeof makeClient>, credit = 0) => {
    const r = await admin.post("/api/admin/users", { name, email, password, credit_limit: credit });
    expectStatus(`建用户 ${name}`, r, 200);
    const id = r.body?.data?.id;
    if (typeof id === "number") userIds.add(id);
    await client.post("/api/auth/login", { email, password });
    return id as number;
  };
  userAId = await mk(`mut-usera-${stamp}`, userAEmail, userA, 50);
  userBId = await mk(`mut-userb-${stamp}`, userBEmail, userB, 0);
  boundId = await mk(BOUND, `mut-bound-${stamp}@example.com`, makeClient(), 0);
  concId = await mk(CONC, `mut-conc-${stamp}@example.com`, makeClient(), 0);
  subId = await mk(SUB, `mut-sub-${stamp}@example.com`, makeClient(), 0);
  abortId = await mk(ABORT, `mut-abort-${stamp}@example.com`, makeClient(), 0);

  const plan = await admin.post("/api/admin/plans", {
    name: planName,
    mode: "subscription",
    pricing_mode: "table",
    quota_kind: "money",
    quota_amount: 20,
    quota_period_days: 30,
    price: 10,
    currency: "CNY",
    features: ["每月 20 元额度"],
  });
  expectStatus("建套餐", plan, 200);
  planId = plan.body?.data?.id;
  if (typeof planId === "number") planIds.add(planId);

  const price = await admin.post(`/api/admin/plans/${planId}/prices`, { model: `mut-model-${stamp}`, input_per_million: 2, output_per_million: 8 });
  expectStatus("加模型价", price, 200);

  expectStatus("给用户 A 代充 100", await admin.post("/api/admin/balances/adjust", { user_id: userAId, amount: 100, reason: "mut 准备", source: "recharge" }), 200);
  expectStatus("给订阅测试用户代充 100", await admin.post("/api/admin/balances/adjust", { user_id: subId, amount: 100, reason: "mut 准备", source: "recharge" }), 200);

  /* ---------------------------------------------- 一、类型错位 */
  console.log("\n【一】类型错位");
  const sc = await admin.post("/api/admin/users", { name: `mut-scratch-${stamp}`, email: `mut-scratch-${stamp}@example.com`, credit_limit: 0 });
  expectStatus("建 scratch 用户", sc, 200);
  scratchId = sc.body?.data?.id;
  userIds.add(scratchId);

  // credit_limit 声明是 number，非数字类型应当 400
  for (const [label, value] of [
    ["字符串数字", "5"],
    ["空数组", []],
    ["布尔 true", true],
  ] as const) {
    const r = await admin.put(`/api/admin/users/${scratchId}`, { credit_limit: value });
    expectStatus(`PUT credit_limit=${label}`, r, 400);
    if (r.status === 200) note(`credit_limit=${label} 被隐式强转后接受了（openapi 声明 number）`, r.body);
  }
  expectStatus("PUT credit_limit=abc", await admin.put(`/api/admin/users/${scratchId}`, { credit_limit: "abc" }), 400);
  expectStatus("PUT credit_limit={}", await admin.put(`/api/admin/users/${scratchId}`, { credit_limit: {} }), 400);
  expectStatus("PUT credit_limit=-1", await admin.put(`/api/admin/users/${scratchId}`, { credit_limit: -1 }), 400);
  expectStatus("PUT credit_limit=null（当没传，合法）", await admin.put(`/api/admin/users/${scratchId}`, { credit_limit: null }), 200);

  // status 声明是整数枚举 0/1
  expectStatus("PUT status=abc", await admin.put(`/api/admin/users/${scratchId}`, { status: "abc" }), 400);
  const stTrue = await admin.put(`/api/admin/users/${scratchId}`, { status: true });
  expectStatus("PUT status=true", stTrue, 400);
  if (stTrue.status === 200) note("status=true 被 Number() 强转成 1 接受了", stTrue.body);
  const stNull = await admin.put(`/api/admin/users/${scratchId}`, { status: null });
  expectStatus("PUT status=null", stNull, 400);
  if (stNull.status === 200) {
    note("status=null 被 Number() 强转成 0，把用户停用了", stNull.body);
    await admin.put(`/api/admin/users/${scratchId}`, { status: 1 });
  }
  expectStatus("PUT role=root", await admin.put(`/api/admin/users/${scratchId}`, { role: "root" }), 400);
  expectStatus("PUT role=123", await admin.put(`/api/admin/users/${scratchId}`, { role: 123 }), 400);

  // plan_id 声明是 integer
  expectStatus("PUT plan_id=abc", await admin.put(`/api/admin/users/${scratchId}`, { plan_id: "abc" }), 400);
  expectStatus("PUT plan_id=[]", await admin.put(`/api/admin/users/${scratchId}`, { plan_id: [] }), 400);
  expectStatus("PUT plan_id={}", await admin.put(`/api/admin/users/${scratchId}`, { plan_id: {} }), 400);
  const pidFloat = await admin.put(`/api/admin/users/${scratchId}`, { plan_id: 1.5 });
  expectStatus("PUT plan_id=1.5", pidFloat, 400);
  if (pidFloat.status === 200) note("plan_id=1.5 被 Math.floor 成 1 接受了", pidFloat.body);

  // 必填字段缺失 / 空对象 / undefined
  expectStatus("POST users 缺 name", await admin.post("/api/admin/users", { email: `mut-noname-${stamp}@example.com` }), 400);
  expectStatus("POST users name=空串", await admin.post("/api/admin/users", { name: "", email: `mut-empty-${stamp}@example.com` }), 400);
  expectStatus("POST users 空对象", await admin.post("/api/admin/users", {}), 400);
  expectStatus("POST adjust 空对象", await admin.post("/api/admin/balances/adjust", {}), 400);
  expectStatus("POST adjust 缺 reason", await admin.post("/api/admin/balances/adjust", { user_id: userAId, amount: 1 }), 400);
  expectStatus("POST adjust 缺 amount", await admin.post("/api/admin/balances/adjust", { user_id: userAId, reason: "x" }), 400);
  expectStatus("POST plans 空对象", await admin.post("/api/admin/plans", {}), 400);
  expectStatus("POST prices 空对象", await admin.post(`/api/admin/plans/${planId}/prices`, {}), 400);

  // 字符串字段传数字 / 对象 / 数组
  const nameObj = await admin.post("/api/admin/users", { name: {}, email: `mut-obj-${stamp}@example.com` });
  expectStatus("POST users name={}（应 400）", nameObj, 400);
  if (nameObj.status === 200) {
    userIds.add(nameObj.body?.data?.id);
    note("name={} 被 String() 成 \"[object Object]\" 建号成功", nameObj.body?.data?.name);
  }
  const nameNum = await admin.post("/api/admin/users", { name: 12345, email: `mut-num-${stamp}@example.com` });
  expectStatus("POST users name=12345（应 400）", nameNum, 400);
  if (nameNum.status === 200) {
    userIds.add(nameNum.body?.data?.id);
    note("name=数字 被 String() 后建号成功", nameNum.body?.data?.name);
  }
  const nameArr = await admin.post("/api/admin/users", { name: [`mut-arr-${stamp}`], email: `mut-arr-${stamp}@example.com` });
  expectStatus("POST users name=[字符串]（应 400）", nameArr, 400);
  if (nameArr.status === 200) {
    userIds.add(nameArr.body?.data?.id);
    note("name=数组 被 String() 后建号成功", nameArr.body?.data?.name);
  }
  expectStatus("POST users name=null", await admin.post("/api/admin/users", { name: null, email: `mut-nullname-${stamp}@example.com` }), 400);
  expectStatus("POST users name=[]", await admin.post("/api/admin/users", { name: [], email: `mut-arrname-${stamp}@example.com` }), 400);

  /* ---------------------------------------------- 二、边界值 */
  console.log("\n【二】边界值");
  const adjBody = (amount: unknown) => ({ user_id: boundId, amount, reason: "mut 边界", source: "adjust" });
  expectStatus("amount=0", await admin.post("/api/admin/balances/adjust", adjBody(0)), 400);
  expectStatus("amount=-0", await admin.post("/api/admin/balances/adjust", adjBody(-0)), 400);
  expectStatus("amount=1e-9（低于精度，四舍五入成 0）", await admin.post("/api/admin/balances/adjust", adjBody(0.000000001)), 400);
  expectStatus("amount=1e-8（最小可存）", await admin.post("/api/admin/balances/adjust", adjBody(0.00000001)), 200);
  expectStatus("amount=-1（合法扣款）", await admin.post("/api/admin/balances/adjust", adjBody(-1)), 200);
  expectStatus("amount=\"1e3\"（字符串科学计数法）", await admin.post("/api/admin/balances/adjust", adjBody("1e3")), 400);
  expectStatus("amount=null", await admin.post("/api/admin/balances/adjust", adjBody(null)), 400);
  expectStatus("amount=true", await admin.post("/api/admin/balances/adjust", adjBody(true)), 400);
  expectStatus("amount=[]", await admin.post("/api/admin/balances/adjust", adjBody([])), 400);

  // 超出 DECIMAL(14,8) 表示范围：整数部分最多 6 位
  for (const [label, value] of [
    ["1e6（7 位整数，超范围）", 1000000],
    ["1e15", 1e15],
    ["Number.MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
    ["-1e15", -1e15],
  ] as const) {
    const r = await admin.post("/api/admin/balances/adjust", adjBody(value));
    expectStatus(`amount=${label}`, r, 400);
  }

  // JSON 文本里塞 NaN / Infinity
  expectStatus(
    "amount=NaN（非法 JSON）",
    await admin.send("POST", "/api/admin/balances/adjust", {
      headers: { "content-type": "application/json" },
      body: `{"user_id":${boundId},"amount":NaN,"reason":"x"}`,
    }),
    400,
  );
  expectStatus(
    "amount=1e999（JSON 解析成 Infinity）",
    await admin.send("POST", "/api/admin/balances/adjust", {
      headers: { "content-type": "application/json" },
      body: `{"user_id":${boundId},"amount":1e999,"reason":"x"}`,
    }),
    400,
  );

  // user_id 边界
  expectStatus("adjust user_id=0", await admin.post("/api/admin/balances/adjust", { user_id: 0, amount: 1, reason: "x" }), 400);
  expectStatus("adjust user_id=-1", await admin.post("/api/admin/balances/adjust", { user_id: -1, amount: 1, reason: "x" }), 400);
  expectStatus("adjust user_id=\"1\"（字符串）", await admin.post("/api/admin/balances/adjust", { user_id: String(userAId), amount: 1, reason: "x" }), 400);
  expectStatus("adjust user_id=1.5", await admin.post("/api/admin/balances/adjust", { user_id: 1.5, amount: 1, reason: "x" }), 400);
  expectStatus("adjust user_id=99999999（不存在）", await admin.post("/api/admin/balances/adjust", { user_id: 99999999, amount: 1, reason: "x" }), 404);

  // 分页边界：非法值静默回落，都是 200
  for (const q of ["page=0", "page=-1", "page=abc", "size=0", "size=-5", "size=abc", "size=101", "size=1e15", "page=1e15", `page=${Number.MAX_SAFE_INTEGER}`]) {
    expectStatus(`GET users?${q}`, await admin.get(`/api/admin/users?${q}`), 200);
  }
  for (const q of ["page=0", "size=0", "size=-1"]) {
    expectStatus(`GET credits?${q}`, await userA.get(`/api/user/credits?${q}`), 200);
  }

  // 套餐边界
  const planBase = { name: `mut-plan-${stamp}`, mode: "subscription", pricing_mode: "table", quota_amount: 20, quota_period_days: 30, price: 10 };
  const expectPlan400 = async (label: string, patch: Record<string, unknown>) => {
    const r = await admin.post("/api/admin/plans", { ...planBase, name: `mut-plan-${label}-${stamp}`, ...patch });
    expectStatus(`POST plans ${label}`, r, 400);
    if (r.status === 200) planIds.add(r.body?.data?.id);
  };
  await expectPlan400("quota_amount=0", { quota_amount: 0 });
  await expectPlan400("quota_amount=-1", { quota_amount: -1 });
  await expectPlan400("quota_period_days=0", { quota_period_days: 0 });
  await expectPlan400("quota_period_days=-30", { quota_period_days: -30 });
  await expectPlan400("markup_multiplier=0", { markup_multiplier: 0 });
  await expectPlan400("price=-1", { price: -1 });
  await expectPlan400("currency=CN", { currency: "CN" });
  await expectPlan400("currency=CNYY", { currency: "CNYY" });
  await expectPlan400("mode=bogus", { mode: "bogus" });
  await expectPlan400("pricing_mode=bogus", { pricing_mode: "bogus" });
  await expectPlan400("quota_kind=bogus", { quota_kind: "bogus" });
  await expectPlan400("overage_mode=bogus", { overage_mode: "bogus" });
  // 可选字段传 null = 当没传，回落默认值（与 credit_limit=null 同一口径）
  const cn = await admin.post("/api/admin/plans", { ...planBase, name: `mut-plan-currency-null-${stamp}`, currency: null });
  expectStatus("POST plans currency=null", cn, 200);
  if (cn.status === 200) {
    planIds.add(cn.body?.data?.id);
    note("currency=null 被当成未传，回落 CNY", { currency: cn.body?.data?.currency });
  }
  expectPlan400("quota_amount=null", { quota_amount: null });
  const sciDays = await admin.post("/api/admin/plans", { ...planBase, name: `mut-sci-${stamp}`, quota_period_days: "1e2" });
  expectStatus("POST plans quota_period_days=\"1e2\"（字符串科学计数法）", sciDays, 400);
  if (sciDays.status === 200) {
    planIds.add(sciDays.body?.data?.id);
    note("quota_period_days=\"1e2\" 被 Number() 强转成 100 接受了", { days: sciDays.body?.data?.quota_period_days });
  }

  // int 列溢出：quota_period_days / sort_order 是 INT
  const daysHuge = await admin.post("/api/admin/plans", { ...planBase, name: `mut-days-${stamp}`, quota_period_days: 1e15 });
  expectStatus("POST plans quota_period_days=1e15（超 INT）", daysHuge, 400);
  if (daysHuge.status === 200) planIds.add(daysHuge.body?.data?.id);
  const sortHuge = await admin.post("/api/admin/plans", { ...planBase, name: `mut-sort-${stamp}`, sort_order: 1e15 });
  expectStatus("POST plans sort_order=1e15（超 INT）", sortHuge, 400);
  if (sortHuge.status === 200) planIds.add(sortHuge.body?.data?.id);

  // 模型价边界
  const pricePath = `/api/admin/plans/${planId}/prices`;
  expectStatus("prices input_per_million=-1", await admin.post(pricePath, { model: `mut-p1-${stamp}`, input_per_million: -1 }), 400);
  expectStatus("prices request_weight=0", await admin.post(pricePath, { model: `mut-p2-${stamp}`, request_weight: 0 }), 400);
  expectStatus("prices request_weight=-1", await admin.post(pricePath, { model: `mut-p3-${stamp}`, request_weight: -1 }), 400);
  expectStatus("prices cost_mode=bogus", await admin.post(pricePath, { model: `mut-p4-${stamp}`, cost_mode: "bogus" }), 400);
  expectStatus("prices model=空串", await admin.post(pricePath, { model: "   " }), 400);
  expectStatus("prices model=129 字符", await admin.post(pricePath, { model: "m".repeat(129) }), 400);
  const wHuge = await admin.post(pricePath, { model: `mut-p5-${stamp}`, request_weight: 1e15 });
  expectStatus("prices request_weight=1e15（超 DECIMAL(14,8)）", wHuge, 400);
  const inHuge = await admin.post(pricePath, { model: `mut-p6-${stamp}`, input_per_million: 1e18 });
  expectStatus("prices input_per_million=1e18（超 DECIMAL(18,8)）", inHuge, 400);
  const perHuge = await admin.post(pricePath, { model: `mut-p7-${stamp}`, per_request: 1e20 });
  expectStatus("prices per_request=1e20", perHuge, 400);
  expectStatus("prices input_per_million=\"2\"（字符串）", await admin.post(pricePath, { model: `mut-p8-${stamp}`, input_per_million: "2" }), 400);
  note("prices 的数字字段用 Number() 收，字符串数字被接受（openapi 声明 number）");

  /* ---------------------------------------------- 三、注入与特殊字符 */
  console.log("\n【三】注入与特殊字符");
  const inj1 = await admin.get(`/api/admin/users?keyword=${encodeURIComponent("' OR 1=1 --")}`);
  expectStatus("keyword=' OR 1=1 --", inj1, 200);
  check("注入片段没有匹配到全表", inj1.body?.total === 0, { total: inj1.body?.total });
  const inj2 = await admin.get(`/api/admin/users?keyword=${encodeURIComponent("'; DROP TABLE users; --")}`);
  expectStatus("keyword='; DROP TABLE users; --", inj2, 200);
  check("users 表仍然存在", Number(await scalar("SELECT COUNT(*) n FROM users")) > 0);

  const pct = await admin.get(`/api/admin/users?keyword=${encodeURIComponent("%")}`);
  expectStatus("keyword=%（LIKE 通配符）", pct, 200);
  check("keyword=% 没有匹配到全表（转义生效）", Number(pct.body?.total) === 0, { total: pct.body?.total });
  const under = await admin.get(`/api/admin/users?keyword=${encodeURIComponent("_")}`);
  expectStatus("keyword=_（LIKE 通配符）", under, 200);
  note("keyword=_ 的结果数（库里有带下划线的人名，无法据此判定转义）", under.body?.total);

  const pctUser = await admin.post("/api/admin/users", { name: PCT, email: `mut-pct-${stamp}@example.com` });
  expectStatus("建带字面 % 的用户", pctUser, 200);
  pctId = pctUser.body?.data?.id;
  userIds.add(pctId);
  const literal = await admin.get(`/api/admin/users?keyword=${encodeURIComponent(PCT)}`);
  check("含 % 的字面关键字能精确搜到", Number(literal.body?.total) === 1, { total: literal.body?.total });

  const opPct = await admin.get(`/api/admin/adjust-logs?operator=${encodeURIComponent("%")}`);
  expectStatus("adjust-logs operator=%", opPct, 200);
  check("operator=% 没有匹配到全部（转义生效）", Number(opPct.body?.total) === 0, { total: opPct.body?.total });
  const refPct = await admin.get(`/api/admin/adjust-logs?ref=${encodeURIComponent("%")}`);
  expectStatus("adjust-logs ref=%", refPct, 200);
  check("ref=% 没有匹配到全部（转义生效）", Number(refPct.body?.total) === 0, { total: refPct.body?.total });
  expectStatus("adjust-logs operator=' OR 1=1 --", await admin.get(`/api/admin/adjust-logs?operator=${encodeURIComponent("' OR 1=1 --")}`), 200);

  // 脚本片段与特殊字符：看是否原样回显
  const xssReason = `<script>alert(1)</script> mut-${stamp}`;
  const xss = await admin.post("/api/admin/balances/adjust", { user_id: boundId, amount: 1, reason: xssReason, source: "adjust" });
  expectStatus("reason 带 script 片段", xss, 200);
  const xssLog = await admin.get(`/api/admin/adjust-logs?ref=${encodeURIComponent(xss.body?.data?.ref ?? "")}&user_id=${boundId}`);
  const echoed = (xssLog.body?.items ?? []).some((it: any) => it.reason === xssReason);
  check("reason 原样落库并回显（未转义）", echoed, xssLog.body?.items?.[0]?.reason);
  if (echoed) note("adjust-logs 原样回显 <script> 片段，转义需前端负责");

  expectStatus("reason 1000 字符", await admin.post("/api/admin/balances/adjust", { user_id: boundId, amount: 1, reason: "a".repeat(1000) }), 400);
  expectStatus("reason 10000 字符", await admin.post("/api/admin/balances/adjust", { user_id: boundId, amount: 1, reason: "a".repeat(10000) }), 400);
  expectStatus("reason 空串", await admin.post("/api/admin/balances/adjust", { user_id: boundId, amount: 1, reason: "   " }), 400);
  expectStatus("reason 257 字符", await admin.post("/api/admin/balances/adjust", { user_id: boundId, amount: 1, reason: "a".repeat(257) }), 400);
  expectStatus("reason 256 字符（正好上界）", await admin.post("/api/admin/balances/adjust", { user_id: boundId, amount: 1, reason: "a".repeat(256) }), 200);
  expectStatus("keyword 8000 字符", await admin.get(`/api/admin/users?keyword=${"k".repeat(8000)}`), 200);
  expectStatus("name 1000 字符", await admin.post("/api/admin/users", { name: "n".repeat(1000) }), 400);
  expectStatus("name 65 字符（超 1 字）", await admin.post("/api/admin/users", { name: "n".repeat(65) }), 400);

  const emojiName = `mut-emoji-😀中文-${stamp}`;
  const emoji = await admin.post("/api/admin/users", { name: emojiName, email: `mut-emoji-${stamp}@example.com` });
  expectStatus("name 含 emoji 与中文", emoji, 200);
  if (emoji.status === 200) {
    userIds.add(emoji.body?.data?.id);
    check("emoji 与中文原样存回", emoji.body?.data?.name === emojiName, emoji.body?.data?.name);
  }
  const ctrlName = `mut-ctrl-\t\n-${stamp}`;
  const ctrl = await admin.post("/api/admin/users", { name: ctrlName, email: `mut-ctrl-${stamp}@example.com` });
  expectStatus("name 含制表符与换行", ctrl, 200);
  if (ctrl.status === 200) {
    userIds.add(ctrl.body?.data?.id);
    note("换行/制表符被接受并原样存回（trim 只去首尾）", JSON.stringify(ctrl.body?.data?.name));
  }
  const bsName = `mut-back\\slash-\`tick\`-${stamp}`;
  const bs = await admin.post("/api/admin/users", { name: bsName, email: `mut-bs-${stamp}@example.com` });
  expectStatus("name 含反斜杠与反引号", bs, 200);
  if (bs.status === 200) userIds.add(bs.body?.data?.id);

  const nulName = `mut-nul-${stamp}\u0000x`;
  const nul = await admin.post("/api/admin/users", { name: nulName, email: `mut-nul-${stamp}@example.com` });
  expectNo5xx("name 含 NUL 字符", nul);
  if (nul.status === 200) {
    userIds.add(nul.body?.data?.id);
    note("NUL 字符被接受", JSON.stringify(nul.body?.data?.name));
  } else {
    note("name 含 NUL 字符被拒", { status: nul.status, body: short(nul.text, 120) });
  }

  /* ---------------------------------------------- 四、协议层 */
  console.log("\n【四】协议层");
  const jsonHeaders = { "content-type": "application/json" };
  for (const [label, path, c] of [
    ["POST users", "/api/admin/users", admin],
    ["POST adjust", "/api/admin/balances/adjust", admin],
    ["POST plans", "/api/admin/plans", admin],
    ["POST prices", `/api/admin/plans/${planId}/prices`, admin],
    ["POST user api_keys", "/api/user/api_keys", userA],
  ] as const) {
    expectStatus(`${label} 非法 JSON「{」`, await c.send("POST", path, { headers: jsonHeaders, body: "{" }), 400);
    expectStatus(`${label} 空 body`, await c.send("POST", path, { headers: jsonHeaders }), 400);
    expectStatus(`${label} 纯文本 body`, await c.send("POST", path, { headers: jsonHeaders, body: "not json at all" }), 400);
  }
  const textPlain = await admin.send("POST", "/api/admin/users", {
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ name: `mut-ct-${stamp}`, email: `mut-ct-${stamp}@example.com` }),
  });
  expectNo5xx("Content-Type=text/plain + 合法 JSON", textPlain);
  note("text/plain 携带合法 JSON 的结果", { status: textPlain.status });
  if (textPlain.status === 200) userIds.add(textPlain.body?.data?.id);

  expectStatus("GET 一个只支持 POST 的路径", await admin.get("/api/admin/balances/adjust"), 404);
  expectStatus("POST 一个只支持 GET 的路径（adjust-logs）", await admin.post("/api/admin/adjust-logs", {}), 404);
  expectStatus("POST 一个只支持 GET 的路径（credits）", await userA.post("/api/user/credits", {}), 404);
  expectStatus("PUT 一个只支持 GET/POST 的路径（users）", await admin.put("/api/admin/users", {}), 404);
  expectStatus("带 query 的 DELETE", await admin.del(`/api/admin/users/${scratchId}?a=1&b=2`), 200);
  await admin.put(`/api/admin/users/${scratchId}`, { status: 1 });
  expectStatus("超长 URL（8000 字符 query）", await admin.get(`/api/admin/users?keyword=${"k".repeat(8000)}`), 200);
  expectNo5xx("超长 URL（30000 字符 query）", await admin.get(`/api/admin/users?keyword=${"k".repeat(30000)}`));
  expectStatus("不存在的路径", await admin.get(`/api/nope-${stamp}`), 404);
  expectStatus("不存在的子路径", await admin.get(`/api/admin/users/${userAId}/nope-${stamp}`), 404);

  /* ---------------------------------------------- 五、路径变异 */
  console.log("\n【五】路径变异");
  expectStatus("GET /api/admin/users/abc", await admin.get("/api/admin/users/abc"), 400);
  expectStatus("GET /api/admin/users/-1", await admin.get("/api/admin/users/-1"), 400);
  expectStatus("GET /api/admin/users/0", await admin.get("/api/admin/users/0"), 400);
  expectStatus("GET /api/admin/users/-0", await admin.get("/api/admin/users/-0"), 400);
  expectStatus("GET /api/admin/users/Infinity", await admin.get("/api/admin/users/Infinity"), 400);
  expectStatus("GET /api/admin/users/NaN", await admin.get("/api/admin/users/NaN"), 400);
  expectNo5xx("GET /api/admin/users/99999999999999999999", await admin.get("/api/admin/users/99999999999999999999"));
  note("id=99999999999999999999 的结果", { status: (await admin.get("/api/admin/users/99999999999999999999")).status });
  const floatId = await admin.get("/api/admin/users/1.5");
  expectStatus("GET /api/admin/users/1.5（非整数）", floatId, 400, 404);
  if (floatId.status === 404) note("id=1.5 返回 404 而不是 400，parseId 只判有限正数");
  const sciId = await admin.get("/api/admin/users/1e3");
  note("id=1e3 的结果", { status: sciId.status });
  expectNo5xx("GET /api/admin/users/1e3", sciId);
  expectStatus("GET /api/admin/users/{id}%20（编码空格）", await admin.get(`/api/admin/users/${userAId}%20`), 400);
  note("路径里的 %20 没被解码，id 就当非法值回 400（不是 200）");
  expectStatus("GET /api/admin/users/%31（URL 编码的 1）", await admin.get("/api/admin/users/%31"), 200, 404);
  expectStatus("路径里带编码的 ../", await admin.get("/api/admin/users/%2e%2e%2f%2e%2e%2fadmin"), 400);
  const traversal = await admin.get(`/api/admin/users/../users/${userAId}`);
  expectStatus("../ 被规范化回同一路由", traversal, 200);
  expectStatus("delete api_keys/abc", await admin.del("/api/admin/api_keys/abc"), 400);
  expectStatus("delete plan_prices/abc", await admin.del("/api/admin/plan_prices/abc"), 400);
  expectStatus("user api_keys delete/abc", await userA.del("/api/user/api_keys/abc"), 400);
  expectStatus("subscribe/abc", await userA.post("/api/user/plans/abc/subscribe"), 400);
  expectStatus("subscribe/-1", await userA.post("/api/user/plans/-1/subscribe"), 400);
  expectNo5xx("subscribe/99999999999999999999", await userA.post("/api/user/plans/99999999999999999999/subscribe"));

  /* ---------------------------------------------- 六、越权 */
  console.log("\n【六】越权");
  const keyB = await admin.post(`/api/admin/users/${userBId}/api_keys`, { name: `mut-keyb-${stamp}` });
  expectStatus("管理员给 B 签一把密钥", keyB, 200);
  keyBId = keyB.body?.data?.id;
  keyBPlain = keyB.body?.data?.key;
  const myB = await userB.get("/api/user/api_keys");
  check("B 的密钥列表里有这一把", (myB.body?.items ?? []).some((k: any) => k.id === keyBId));

  expectStatus("普通用户访问 /api/admin/users", await userA.get("/api/admin/users"), 403);
  expectStatus("普通用户访问用户详情", await userA.get(`/api/admin/users/${userBId}`), 403);
  expectStatus("普通用户访问他人密钥列表", await userA.get(`/api/admin/users/${userBId}/api_keys`), 403);
  expectStatus("普通用户调账", await userA.post("/api/admin/balances/adjust", { user_id: userAId, amount: 1, reason: "x" }), 403);
  expectStatus("普通用户访问 adjust-logs", await userA.get("/api/admin/adjust-logs"), 403);
  expectStatus("普通用户建套餐", await userA.post("/api/admin/plans", { name: `mut-hack-${stamp}`, mode: "pay_as_you_go", pricing_mode: "markup" }), 403);
  expectStatus("普通用户删他人密钥（admin 路径）", await userA.del(`/api/admin/api_keys/${keyBId}`), 403);
  expectStatus("普通用户读他人订阅历史", await userA.get(`/api/admin/plan-activations/${userBId}/history`), 403);

  const delOther = await userA.del(`/api/user/api_keys/${keyBId}`);
  expectStatus("A 删 B 的密钥（应 404）", delOther, 404);
  const stillThere = await scalar("SELECT COUNT(*) n FROM api_keys WHERE id = ?", [keyBId]);
  check("B 的密钥没被删掉", Number(stillThere) === 1, { remaining: Number(stillThere) });
  const listA = await userA.get("/api/user/api_keys");
  check("A 的密钥列表里看不到 B 的密钥", !(listA.body?.items ?? []).some((k: any) => k.id === keyBId));

  expectStatus("无会话访问 admin/users", await anon.get("/api/admin/users"), 401);
  expectStatus("无会话访问 user/me", await anon.get("/api/user/me"), 401);
  expectStatus("无会话访问 credits", await anon.get("/api/user/credits"), 401);
  expectStatus("无会话调账", await anon.post("/api/admin/balances/adjust", { user_id: userAId, amount: 1, reason: "x" }), 401);
  expectStatus("无会话订阅", await anon.post(`/api/user/plans/${planId}/subscribe`), 401);

  // 伪造 / 篡改 cookie
  const goodCookie = userA.cookie();
  const jwt = decodeURIComponent(goodCookie.split("=").slice(1).join("="));
  const [h, p, s] = jwt.split(".");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  const forgedPayload = Buffer.from(JSON.stringify({ ...payload, sub: String(adminId), role: "admin" })).toString("base64url");
  const raised = makeClient();
  raised.set(`tokenmp_session=${h}.${forgedPayload}.${s}`);
  expectStatus("篡改 JWT 载荷（sub 改成管理员）", await raised.get("/api/admin/users"), 401);
  const badSig = makeClient();
  badSig.set(`tokenmp_session=${h}.${p}.${s.slice(0, -2)}AA`);
  expectStatus("篡改 JWT 签名", await badSig.get("/api/user/me"), 401);
  const noneAlg = makeClient();
  noneAlg.set(`tokenmp_session=${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${p}.`);
  expectStatus("alg=none 攻击", await noneAlg.get("/api/user/me"), 401);
  const garbage = makeClient();
  garbage.set("tokenmp_session=not-a-jwt");
  expectStatus("垃圾 cookie", await garbage.get("/api/user/me"), 401);

  // 已停用用户的旧会话
  const disabledEmail = `mut-disabled-${stamp}@example.com`;
  const disabledName = `mut-disabled-${stamp}`;
  const disabledClient = makeClient();
  const disId = await mk(disabledName, disabledEmail, disabledClient, 0);
  check("停用测试用户已登录", disabledClient.cookie() !== "");
  expectStatus("停用前旧会话可用", await disabledClient.get("/api/user/me"), 200);
  expectStatus("停用该用户", await admin.del(`/api/admin/users/${disId}`), 200);
  expectStatus("停用后旧会话立即失效", await disabledClient.get("/api/user/me"), 401);
  expectStatus("停用后重新登录被拒", await disabledClient.post("/api/auth/login", { email: disabledEmail, password }), 403);

  /* ---------------------------------------------- 七、并发 */
  console.log("\n【七】并发");
  const N = 20;
  const concResults = await Promise.all(
    Array.from({ length: N }, () => admin.post("/api/admin/balances/adjust", { user_id: concId, amount: 1, reason: "mut 并发 +1", source: "adjust" })),
  );
  const concOk = concResults.filter(r => r.status === 200).length;
  const concBalance = Number(await scalar("SELECT balance FROM users WHERE id = ?", [concId]));
  const concTx = Number(await scalar("SELECT COUNT(*) n FROM credit_transactions WHERE user_id = ? AND source = 'adjust'", [concId]));
  check(`并发 ${N} 次 +1 全部成功`, concOk === N, { 成功: concOk, 失败: N - concOk });
  check(`并发后余额精确等于 ${N}（丢更新会小于）`, concBalance === N, { 余额: concBalance, 流水行数: concTx });
  check("流水行数与成功请求数一致", concTx === concOk, { 流水行数: concTx, 成功: concOk });
  console.log(`  并发 +1：成功 ${concOk}/${N}，余额 ${concBalance}，流水 ${concTx} 行`);

  const subBalBefore = Number(await scalar("SELECT balance FROM users WHERE id = ?", [userAId]));
  const subTxBefore = Number(await scalar("SELECT COUNT(*) n FROM credit_transactions WHERE user_id = ? AND source = 'subscription'", [userAId]));
  const subResults = await Promise.all(Array.from({ length: 5 }, () => userA.post(`/api/user/plans/${planId}/subscribe`)));
  const subOk = subResults.filter(r => r.status === 200).length;
  const subBalance = Number(await scalar("SELECT balance FROM users WHERE id = ?", [userAId]));
  const subRows = Number(await scalar("SELECT COUNT(*) n FROM subscriptions WHERE user_id = ? AND plan_id = ?", [userAId, planId]));
  const subTx = Number(await scalar("SELECT COUNT(*) n FROM credit_transactions WHERE user_id = ? AND source = 'subscription'", [userAId]));
  check("并发订阅返回的码都在 {200,402}", subResults.every(r => r.status === 200 || r.status === 402), subResults.map(r => r.status));
  check("并发订阅的余额 = 订阅前余额 − 10×本次扣款次数", subBalance === subBalBefore - 10 * (subTx - subTxBefore), { 余额: subBalance, 之前: subBalBefore, 本次扣款: subTx - subTxBefore });
  check("订阅行数与扣款次数一致（无半截数据）", subRows === subTx, { 订阅行数: subRows, 流水行数: subTx });
  console.log(`  并发订阅：200 ${subOk}/5，余额 ${subBalBefore}→${subBalance}，subscriptions ${subRows} 行，扣款流水 ${subTx} 行`);
  note("并发订阅没有幂等保护时会计 5 次；上面数字即实际行为", { 成功: subOk, 扣款次数: subTx });

  const raceName = `mut-race-${stamp}`;
  const race = await Promise.all(Array.from({ length: 10 }, () => admin.post("/api/admin/users", { name: raceName, email: `mut-race-${stamp}@example.com` })));
  const raceCodes = race.map(r => r.status);
  const raceOk = raceCodes.filter(s => s === 200).length;
  const race409 = raceCodes.filter(s => s === 409).length;
  const race5xx = raceCodes.filter(s => s >= 500).length;
  const raceRows = Number(await scalar("SELECT COUNT(*) n FROM users WHERE name = ?", [raceName]));
  for (const r of race) if (r.status === 200) userIds.add(r.body?.data?.id);
  check("并发建同名用户只有 1 个成功", raceOk === 1, { 200: raceOk, 409: race409, 错误: race5xx, 全部: raceCodes });
  check("并发建同名用户的败者回 409 而不是 500", race409 === 9 && race5xx === 0, { 200: raceOk, 409: race409, 错误: race5xx, 全部: raceCodes });
  check("库里同名用户只有 1 行", raceRows === 1, { 行数: raceRows });
  console.log(`  并发建同名用户：${JSON.stringify(raceCodes)}，库里 ${raceRows} 行`);

  const raceModel = `mut-racemodel-${stamp}`;
  const racePrice = await Promise.all(Array.from({ length: 10 }, () => admin.post(`/api/admin/plans/${planId}/prices`, { model: raceModel, input_per_million: 1 })));
  const rpCodes = racePrice.map(r => r.status);
  const rpOk = rpCodes.filter(s => s === 200).length;
  const rp409 = rpCodes.filter(s => s === 409).length;
  const rp5xx = rpCodes.filter(s => s >= 500).length;
  const rpRows = Number(await scalar("SELECT COUNT(*) n FROM plan_prices WHERE plan_id = ? AND model = ?", [planId, raceModel]));
  check("并发建同模型价只有 1 个成功", rpOk === 1, { 成功: rpOk, 冲突: rp409, 错误: rp5xx, 全部: rpCodes });
  check("并发建同模型价的败者回 409 而不是 500", rp409 === 9 && rp5xx === 0, { 成功: rpOk, 冲突: rp409, 错误: rp5xx, 全部: rpCodes });
  check("库里只有 1 行模型价", rpRows === 1, { 行数: rpRows });
  console.log(`  并发建同模型价：${JSON.stringify(rpCodes)}，库里 ${rpRows} 行`);

  const racePlanName = `mut-raceplan-${stamp}`;
  const racePlan = await Promise.all(
    Array.from({ length: 10 }, () => admin.post("/api/admin/plans", { name: racePlanName, mode: "pay_as_you_go", pricing_mode: "markup" })),
  );
  const rplCodes = racePlan.map(r => r.status);
  const rplOk = rplCodes.filter(s => s === 200).length;
  const rpl409 = rplCodes.filter(s => s === 409).length;
  const rpl5xx = rplCodes.filter(s => s >= 500).length;
  const rplRows = Number(await scalar("SELECT COUNT(*) n FROM plans WHERE name = ?", [racePlanName]));
  check("并发建同名套餐只有 1 个成功", rplOk === 1, { 成功: rplOk, 冲突: rpl409, 错误: rpl5xx, 全部: rplCodes });
  check("并发建同名套餐没有 500", rpl5xx === 0, { 错误: rpl5xx, 全部: rplCodes });
  check("库里同名套餐只有 1 行", rplRows === 1, { 行数: rplRows });
  console.log(`  并发建同名套餐：${JSON.stringify(rplCodes)}，库里 ${rplRows} 行`);

  /* ---------------------------------------------- 八、中断 */
  console.log("\n【八】中断（AbortController）");
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const aborted: string[] = [];
  for (let i = 0; i < 8; i++) {
    const ctrl = new AbortController();
    const delay = i % 4; // 0/1/2/3ms，覆盖「还没发出去」与「正在写库」两种时机
    const p = admin.send("POST", "/api/admin/balances/adjust", { json: true, payload: { user_id: abortId, amount: 1, reason: `mut abort ${i}` }, signal: ctrl.signal });
    if (delay === 0) ctrl.abort();
    else setTimeout(() => ctrl.abort(), delay);
    const r = await p;
    if (r.status === 0) aborted.push("abort");
    else aborted.push(String(r.status));
  }
  note("中断调账的客户端结果", aborted);
  // 客户端 abort 了，但服务端可能在继续跑。等写完再读，否则读到的是中间态
  await sleep(1000);
  const abBalance = Number(await scalar("SELECT balance FROM users WHERE id = ?", [abortId]));
  const abSum = Number(await scalar("SELECT COALESCE(SUM(delta),0) s FROM credit_transactions WHERE user_id = ?", [abortId]));
  const abCount = Number(await scalar("SELECT COUNT(*) n FROM credit_transactions WHERE user_id = ?", [abortId]));
  const abLast = Number(await scalar("SELECT COALESCE(MAX(balance_after),0) b FROM credit_transactions WHERE user_id = ?", [abortId]));
  check("中断后余额等于流水累计（无半截记账）", abBalance === abSum, { 余额: abBalance, 流水累计: abSum, 行数: abCount });
  check("最大 balance_after 等于当前余额", abLast === abBalance, { 最大: abLast, 余额: abBalance });
  check(`落库行数不超过发起的请求数（${abCount}/8）`, abCount <= 8, { 行数: abCount, 客户端: aborted });
  if (abCount > 0) note("客户端 abort 后服务端仍会把请求跑完并落库（abort 不取消服务端），所以行数可以 > 0", { 落库行数: abCount });

  const abBalBefore = Number(await scalar("SELECT balance FROM users WHERE id = ?", [userAId]));
  const abCreditBefore = Number(await scalar("SELECT credit_used FROM users WHERE id = ?", [userAId]));
  const abTxBefore = Number(await scalar("SELECT COUNT(*) n FROM credit_transactions WHERE user_id = ? AND source = 'subscription'", [userAId]));
  const abortedSub: string[] = [];
  for (let i = 0; i < 6; i++) {
    const ctrl = new AbortController();
    const delay = i % 3;
    const p = userA.send("POST", `/api/user/plans/${planId}/subscribe`, { json: true, payload: undefined, signal: ctrl.signal });
    if (delay === 0) ctrl.abort();
    else setTimeout(() => ctrl.abort(), delay);
    const r = await p;
    abortedSub.push(r.status === 0 ? "abort" : String(r.status));
  }
  note("中断订阅的客户端结果", abortedSub);
  await sleep(1000);
  const abSubTx = Number(await scalar("SELECT COUNT(*) n FROM credit_transactions WHERE user_id = ? AND source = 'subscription'", [userAId]));
  const abSubRows = Number(await scalar("SELECT COUNT(*) n FROM subscriptions WHERE user_id = ? AND plan_id = ?", [userAId, planId]));
  const abBal = Number(await scalar("SELECT balance FROM users WHERE id = ?", [userAId]));
  const abCredit = Number(await scalar("SELECT credit_used FROM users WHERE id = ?", [userAId]));
  check("中断订阅后订阅行数 == 扣款流水数", abSubRows === abSubTx, { 订阅行数: abSubRows, 扣款流水: abSubTx });
  // 余额不够时会接着占信用额度，所以不变量要算上 credit_used 的变化
  const abSpent = (abBalBefore - abBal) + (abCredit - abCreditBefore);
  check("中断订阅后扣款总额自洽（余额 + 信用额度变化 = 10×扣款次数）", abSpent === 10 * (abSubTx - abTxBefore), { 本次扣款: abSubTx - abTxBefore, 余额变化: abBalBefore - abBal, 信用变化: abCredit - abCreditBefore });
  const subUserBal = Number(await scalar("SELECT balance FROM users WHERE id = ?", [subId]));
  check("另一个用户的余额未被中断影响到（仍为 100）", subUserBal === 100, { 余额: subUserBal });

  /* ---------------------------------------------- 九、幂等 / 重复提交 */
  console.log("\n【九】幂等 / 重复提交");
  const idemUser = await admin.post("/api/admin/users", { name: `mut-idem-${stamp}`, email: `mut-idem-${stamp}@example.com` });
  expectStatus("建幂等测试用户", idemUser, 200);
  const idemId = idemUser.body?.data?.id;
  userIds.add(idemId);
  expectStatus("DELETE 用户第一次", await admin.del(`/api/admin/users/${idemId}`), 200);
  expectStatus("DELETE 同一用户第二次（幂等）", await admin.del(`/api/admin/users/${idemId}`), 200);
  expectStatus("DELETE 不存在的用户 id", await admin.del("/api/admin/users/99999999"), 200);

  const idemKey = await admin.post(`/api/admin/users/${idemId}/api_keys`, { name: "幂等密钥" });
  expectStatus("给幂等用户签密钥", idemKey, 200);
  const idemKeyId = idemKey.body?.data?.id;
  expectStatus("DELETE 同一密钥第一次", await admin.del(`/api/admin/api_keys/${idemKeyId}`), 200);
  expectStatus("DELETE 同一密钥第二次（幂等）", await admin.del(`/api/admin/api_keys/${idemKeyId}`), 200);

  const idemPrice = await admin.post(`/api/admin/plans/${planId}/prices`, { model: `mut-idemmodel-${stamp}`, input_per_million: 1 });
  expectStatus("加一条模型价", idemPrice, 200);
  const idemPriceId = idemPrice.body?.data?.id;
  expectStatus("DELETE 同一模型价第一次", await admin.del(`/api/admin/plan_prices/${idemPriceId}`), 200);
  expectStatus("DELETE 同一模型价第二次（幂等）", await admin.del(`/api/admin/plan_prices/${idemPriceId}`), 200);

  const selfKey = await userB.post("/api/user/api_keys", { name: "自签幂等" });
  expectStatus("用户 B 自签密钥", selfKey, 200);
  const selfKeyId = selfKey.body?.data?.id;
  expectStatus("用户删自己的密钥第一次", await userB.del(`/api/user/api_keys/${selfKeyId}`), 200);
  expectStatus("用户删自己的密钥第二次（openapi 声明 404）", await userB.del(`/api/user/api_keys/${selfKeyId}`), 404);

  const repeatBalBefore = Number(await scalar("SELECT balance FROM users WHERE id = ?", [userAId]));
  expectStatus("用户 A 连续订阅两次（第一次）", await userA.post(`/api/user/plans/${planId}/subscribe`), 200);
  expectStatus("用户 A 连续订阅两次（第二次）", await userA.post(`/api/user/plans/${planId}/subscribe`), 200);
  const repeatBalAfter = Number(await scalar("SELECT balance FROM users WHERE id = ?", [userAId]));
  note("重复点订阅连扣两次，扣 20 元（无幂等保护，属文档化的续费语义）", { before: repeatBalBefore, after: repeatBalAfter });

  // PUT 整体替换：缺失字段写成默认值（openapi 文档化的行为）
  const scratchPlan = await admin.post("/api/admin/plans", { name: `mut-替换-${stamp}`, mode: "subscription", pricing_mode: "table", quota_amount: 20, quota_period_days: 30, price: 10 });
  expectStatus("建替换测试套餐", scratchPlan, 200);
  scratchPlanId = scratchPlan.body?.data?.id;
  planIds.add(scratchPlanId);
  expectStatus(
    "PUT 整体替换（只给必填三项）",
    await admin.put(`/api/admin/plans/${scratchPlanId}`, { name: `mut-替换2-${stamp}`, mode: "pay_as_you_go", pricing_mode: "markup" }),
    200,
  );
  const replaced = await admin.get(`/api/admin/plans/${scratchPlanId}`);
  check("整体替换把未传的 quota_amount 写成默认 0", Number(replaced.body?.data?.plan?.quota_amount) === 0, { quota_amount: replaced.body?.data?.plan?.quota_amount });
  expectStatus("DELETE 软删套餐", await admin.del(`/api/admin/plans/${scratchPlanId}`), 200);
  expectStatus("DELETE 同一套餐第二次（openapi 只列 200）", await admin.del(`/api/admin/plans/${scratchPlanId}`), 200, 404);
  const planDel2 = await admin.del(`/api/admin/plans/${scratchPlanId}`);
  if (planDel2.status === 404) note("重复删套餐回 404，不是幂等 200（openapi 未列 404）");
} catch (err) {
  fail++;
  failures.push(`脚本异常：${(err as Error)?.stack ?? String(err)}`);
  console.error("\n脚本异常：", err);
} finally {
  /* ------------------------------------------------------------------ 清理 */
  console.log("\n【清理】只清本次 stamp 造出来的记录");
  try {
    const ids = [...userIds].filter(n => Number.isFinite(n));
    const pids = [...planIds].filter(n => Number.isFinite(n));
    if (ids.length) {
      await conn.query("DELETE FROM credit_transactions WHERE user_id IN (?)", [ids]);
      await conn.query("DELETE FROM subscriptions WHERE user_id IN (?)", [ids]);
      await conn.query("DELETE FROM api_keys WHERE user_id IN (?)", [ids]);
      await conn.query("DELETE FROM user_budgets WHERE user_id IN (?)", [ids]);
    }
    // 兜底：本次 stamp 建出来但没记到 id 的用户（只在 mut- 前缀里找）
    const [extra] = (await conn.query("SELECT id FROM users WHERE name LIKE ?", [`mut-%${stamp}%`])) as any;
    const extraIds = (extra as any[]).map(r => r.id).filter((n: number) => !ids.includes(n));
    if (extraIds.length) {
      await conn.query("DELETE FROM credit_transactions WHERE user_id IN (?)", [extraIds]);
      await conn.query("DELETE FROM subscriptions WHERE user_id IN (?)", [extraIds]);
      await conn.query("DELETE FROM api_keys WHERE user_id IN (?)", [extraIds]);
      await conn.query("DELETE FROM user_budgets WHERE user_id IN (?)", [extraIds]);
      await conn.query("DELETE FROM users WHERE id IN (?)", [extraIds]);
    }
    if (ids.length) await conn.query("DELETE FROM users WHERE id IN (?)", [ids]);
    if (pids.length) {
      await conn.query("DELETE FROM subscriptions WHERE plan_id IN (?)", [pids]);
      await conn.query("DELETE FROM plan_prices WHERE plan_id IN (?)", [pids]);
      await conn.query("DELETE FROM plans WHERE id IN (?)", [pids]);
    }
    // 并发建的套餐只记了名字
    await conn.query("DELETE FROM plan_prices WHERE plan_id IN (SELECT id FROM plans WHERE name LIKE ?)", [`mut-%${stamp}%`]);
    await conn.query("DELETE FROM subscriptions WHERE plan_id IN (SELECT id FROM plans WHERE name LIKE ?)", [`mut-%${stamp}%`]);
    await conn.query("DELETE FROM plans WHERE name LIKE ?", [`mut-%${stamp}%`]);

    const leftoverUsers = Number(await scalar("SELECT COUNT(*) n FROM users WHERE name LIKE ?", [`mut-%${stamp}%`]));
    const leftoverPlans = Number(await scalar("SELECT COUNT(*) n FROM plans WHERE name LIKE ?", [`mut-%${stamp}%`]));
    const leftoverTx = ids.length ? Number(await scalar("SELECT COUNT(*) n FROM credit_transactions WHERE user_id IN (?)", [ids])) : 0;
    check("清理后本次用户为 0", leftoverUsers === 0, { 剩余: leftoverUsers });
    check("清理后本次套餐为 0", leftoverPlans === 0, { 剩余: leftoverPlans });
    check("清理后本次流水为 0", leftoverTx === 0, { 剩余: leftoverTx });
  } catch (e) {
    check("清理过程无异常", false, String(e));
  }

  /* ------------------------------------------------------------------ 存活 */
  console.log("\n【存活检查】");
  let alive = false;
  let versionText = "";
  try {
    const v = await fetch(`${BASE}/api/system/version`);
    versionText = (await v.text()).slice(0, 80);
    alive = v.status === 200;
  } catch (e) {
    versionText = String(e);
  }
  check("服务跑完仍然存活（/api/system/version 2xx）", alive, versionText);
  const ss = await import("node:child_process");
  const listening = ss.execSync("ss -ltn | grep -c ':6789' || true").toString().trim();
  check("6789 仍在监听", Number(listening) >= 1, { listening });

  await conn.end();

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项（共 ${pass + fail} 项变异）`);
  console.log(`捕获到 5xx 响应 ${fiveHundreds.length} 次`);
  if (fiveHundreds.length) {
    console.log("\n=== 500 清单 ===");
    const seen = new Set<string>();
    for (const f of fiveHundreds) {
      const k = `${f.method} ${f.path} ${f.req}`;
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(`  ${f.method} ${f.path}\n    请求体: ${f.req}\n    响应:   ${f.res}`);
    }
    console.log(`  （去重后 ${seen.size} 条，实际发生 ${fiveHundreds.length} 次）`);
  }
  if (failures.length) {
    console.log("\n=== 失败明细 ===");
    for (const f of failures) console.log(`  - ${f}`);
  }
  if (notes.length) {
    console.log("\n=== 值得留意的观察 ===");
    for (const n of notes) console.log(`  · ${n}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}
