/**
 * #34 已停用套餐恢复的端到端验证。
 *
 * 不起服务器：直接拿路由导出的 handler 来调，请求里带一个现签的会话 cookie
 * （会话是无状态 JWT，见 src/lib/auth.ts 的 signSession）。
 * 测试套餐由本脚本现建，结束后按 id 删干净，不碰库里别的数据。
 *
 *   bun run scripts/verify-34.ts
 *
 * 依赖本地 MySQL（sudo docker compose up -d）。脚本结尾 process.exit，
 * 免得 mysql 连接池把进程吊住。
 */
import mysql from "mysql2/promise";

import { signSession } from "../src/lib/auth";
import { GET as plansListGet } from "../src/routes/api/admin/plans";
import { DELETE as planDelete } from "../src/routes/api/admin/plans/[id]";
import { POST as planEnablePost } from "../src/routes/api/admin/plans/[id]/enable";

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

const conn = await mysql.createConnection({
  uri: process.env.DATABASE_URL ?? "mysql://tokenmp:tokenmp-dev@127.0.0.1:3307/tokenmp",
  timezone: "Z",
});

const stamp = Date.now();
const planName = `tv34-${stamp}`;
// 撞不到库里已有数据的、明确不存在的 id
const missingId = 9_000_000_000 + (stamp % 1000);

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

let planId = 0;
let adminToken = "";

async function insertPlan(name: string) {
  const [res]: any = await conn.query(
    "INSERT INTO plans (name, mode, pricing_mode, quota_kind, quota_amount, quota_period_days, price, status, created_at, updated_at) " +
      "VALUES (?, 'subscription', 'table', 'money', 100, 30, 100, 1, NOW(3), NOW(3))",
    [name],
  );
  return Number(res.insertId);
}

async function planStatus(id: number) {
  const [r]: any = await conn.query("SELECT status FROM plans WHERE id = ?", [id]);
  return r[0] ? Number(r[0].status) : null;
}

/** 默认列表（status=1）里有没有这个套餐 */
async function inDefaultList(id: number) {
  const res = await call(plansListGet, { path: "/api/admin/plans", token: adminToken });
  if (res.status !== 200) return false;
  return Array.isArray(res.body.items) && res.body.items.some((item: any) => item.id === id);
}

try {
  /* ---------------------------------------------------------- 准备数据 */
  const [admin]: any = await conn.query(
    "SELECT id, token_version FROM users WHERE role = 'admin' AND status = 1 LIMIT 1",
  );
  if (!admin[0]) throw new Error("库里没有可用的管理员，先跑一次 db/init");
  adminToken = await signSession({
    sub: Number(admin[0].id),
    tv: Number(admin[0].token_version),
    role: "admin",
  });

  planId = await insertPlan(planName);
  check("测试套餐已建好且在售", (await planStatus(planId)) === 1, { planId });

  /* --------------------------------------- 软删之后 restore 回在售 */
  console.log("\n[软删 -> 恢复]");
  const del = await call(planDelete, {
    method: "DELETE",
    path: `/api/admin/plans/${planId}`,
    token: adminToken,
    params: { id: String(planId) },
  });
  check("DELETE 软删成功", del.status === 200 && del.body?.ok === true, del.body);
  check("软删后 status=0", (await planStatus(planId)) === 0, { planId });
  check("软删后默认列表看不到", (await inDefaultList(planId)) === false);
  // 顺带确认含已停用列表能看到（status=all）
  const allList = await call(plansListGet, {
    path: "/api/admin/plans?status=all",
    token: adminToken,
  });
  check(
    "status=all 看得到已停用的它",
    allList.status === 200 && allList.body.items.some((item: any) => item.id === planId),
    { status: allList.status },
  );

  const enable = await call(planEnablePost, {
    method: "POST",
    path: `/api/admin/plans/${planId}/enable`,
    token: adminToken,
    params: { id: String(planId) },
  });
  check("enable 回 200 与 {ok:true}", enable.status === 200 && enable.body?.ok === true, enable.body);
  check("恢复后 status 回到 1", (await planStatus(planId)) === 1, { planId });
  check("恢复后默认列表又能看到", (await inDefaultList(planId)) === true);

  /* ------------------------------------------------------- 幂等 */
  console.log("\n[幂等]");
  const again = await call(planEnablePost, {
    method: "POST",
    path: `/api/admin/plans/${planId}/enable`,
    token: adminToken,
    params: { id: String(planId) },
  });
  check("对已启用的套餐再 enable 仍回 200", again.status === 200 && again.body?.ok === true, again.body);
  check("重复 enable 后 status 仍是 1", (await planStatus(planId)) === 1);

  /* ------------------------------------------------ 不存在的 id */
  console.log("\n[不存在的 id]");
  const notFound = await call(planEnablePost, {
    method: "POST",
    path: `/api/admin/plans/${missingId}/enable`,
    token: adminToken,
    params: { id: String(missingId) },
  });
  check("enable 不存在的 id 回 404", notFound.status === 404, notFound.body);

  const badId = await call(planEnablePost, {
    method: "POST",
    path: "/api/admin/plans/abc/enable",
    token: adminToken,
    params: { id: "abc" },
  });
  check("enable 非法 id 回 400", badId.status === 400, badId.body);

  /* ---------------------------------------------- 未登录 / 非管理员 */
  console.log("\n[鉴权]");
  const anon = await call(planEnablePost, {
    method: "POST",
    path: `/api/admin/plans/${planId}/enable`,
    token: null,
    params: { id: String(planId) },
  });
  check("没带会话回 401", anon.status === 401, anon.body);
} catch (err) {
  failed += 1;
  console.error("\n脚本异常：", err);
} finally {
  // 只删本脚本建的那一行，且按 id 精确删
  if (planId) {
    await conn.query("DELETE FROM plan_prices WHERE plan_id = ?", [planId]);
    await conn.query("DELETE FROM plans WHERE id = ?", [planId]);
  }
  await conn.end();
}

console.log(`\n通过 ${passed} 条，失败 ${failed} 条`);
process.exit(failed > 0 ? 1 : 0);
