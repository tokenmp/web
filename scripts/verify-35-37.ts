/**
 * #35（GET /api/admin/users 加 status 参数）与 #37（AdminUser / fetchAdminUsers 合并到一处）
 * 的验证脚本。
 *
 * 不起服务器：直接拿路由导出的 handler 来调，请求里带一个现签的会话 cookie
 * （会话是无状态 JWT，见 src/lib/auth.ts 的 signSession）。管理员从库里现有的
 * role=admin 账号里取，取不到才临时建一个。测试用户是本脚本现建的，
 * 结束时按 id 删除，只碰自己造的那两条，库里其它数据一概不动。
 *
 *   bun run scripts/verify-35-37.ts
 *
 * 依赖本地 MySQL（docker compose 起的 3307）。脚本结尾 process.exit，
 * 免得 mysql 连接池把进程吊住。
 *
 * 关于并发：同一台库上可能还有别的验证脚本在建号删号，全局计数会抖。
 * 所以凡是拿「请求里的 total」跟「SQL 直接数出来的行数」对比的地方，
 * 都取请求前后的两次计数，只有两次一致才认这次对比，最多重试 6 轮。
 */
import fs from "node:fs";
import path from "node:path";

import mysql from "mysql2/promise";

import { signSession } from "../src/lib/auth";
import { GET as usersGet } from "../src/routes/api/admin/users";

type Handler = (event: unknown) => Promise<Response>;

async function call(
  handler: unknown,
  options: { path: string; token?: string | null; method?: string; body?: unknown },
) {
  const headers: Record<string, string> = {};
  if (options.token) headers.cookie = `tokenmp_session=${options.token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const request = new Request(`http://localhost:6789${options.path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

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

// timezone 跟 src/lib/db.ts 保持一致，读写 datetime 不被时区平移
const conn = await mysql.createConnection({
  uri: process.env.DATABASE_URL ?? "mysql://tokenmp:tokenmp-dev@127.0.0.1:3307/tokenmp",
  timezone: "Z",
});

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

async function countUsers(status?: number) {
  const [rows]: any =
    status === undefined
      ? await conn.query("SELECT COUNT(*) AS n FROM users")
      : await conn.query("SELECT COUNT(*) AS n FROM users WHERE status = ?", [status]);
  return Number(rows[0].n);
}

async function listUsers(query: string) {
  const { status, body } = await call(usersGet, {
    path: `/api/admin/users${query}`,
    token: adminToken,
  });
  return {
    status,
    total: Number(body?.total ?? NaN),
    items: Array.isArray(body?.items) ? body.items : [],
    body,
  };
}

/**
 * 在计数稳定的窗口里做请求：请求前后各数一次库，两次一样才说明没有别的 writer
 * 插进来，这时才拿请求里的 total 跟这个数对比。抖动就重试。
 */
async function inStableWindow<T>(expected: () => Promise<number>, work: () => Promise<T>) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const before = await expected();
    const result = await work();
    const after = await expected();
    if (before === after) return { count: before, result };
  }
  return null;
}

/** 请求里的 total 必须等于此刻库里对应的行数 */
async function expectTotal(label: string, query: string, expected: () => Promise<number>) {
  const window = await inStableWindow(expected, () => listUsers(query));
  if (!window) {
    check(label, false, "库里的行数一直在变，6 轮都没取到稳定窗口");
    return;
  }
  const ok = window.result.status === 200 && window.result.total === window.count;
  check(`${label}（total=${window.count}）`, ok, {
    httpStatus: window.result.status,
    apiTotal: window.result.total,
    dbCount: window.count,
  });
}

/* ---------------------------------------------------------------- 准备会话 */

const [adminRows]: any = await conn.query(
  "SELECT id, token_version, role FROM users WHERE role = 'admin' AND status = 1 ORDER BY id LIMIT 1",
);

let tempAdminId = 0;
let adminRow = adminRows[0];
if (!adminRow) {
  const stamp = Date.now();
  const [res]: any = await conn.query(
    "INSERT INTO users (name, email, password_hash, role, status, credit_limit, balance, credit_used, token_version, source, created_at, updated_at) " +
      "VALUES (?, ?, 'x', 'admin', 1, 0, 0, 0, 0, 'local', NOW(3), NOW(3))",
    [`verify-35-admin-${stamp}`, `verify-35-admin-${stamp}@example.com`],
  );
  tempAdminId = Number(res.insertId);
  adminRow = { id: tempAdminId, token_version: 0, role: "admin" };
  console.log(`库里没有启用的管理员，临时建了 #${tempAdminId}`);
}

const adminToken = await signSession({
  sub: Number(adminRow.id),
  tv: Number(adminRow.token_version),
  role: String(adminRow.role),
});

/* ------------------------------------------------- 造两条带标记的测试用户 */

const stamp = Date.now();
const marker = `v3537-${stamp}`;
const madeIds: number[] = [];

async function insertUser(name: string, status: number) {
  const [res]: any = await conn.query(
    "INSERT INTO users (name, email, password_hash, role, status, credit_limit, balance, credit_used, token_version, source, created_at, updated_at) " +
      "VALUES (?, ?, 'x', 'user', ?, 0, 0, 0, 0, 'local', NOW(3), NOW(3))",
    [name, `${name}@example.com`, status],
  );
  const id = Number(res.insertId);
  madeIds.push(id);
  return id;
}

const activeId = await insertUser(`正常-${marker}`, 1);
const bannedId = await insertUser(`停用-${marker}`, 0);

async function countMarker(status: number) {
  const [rows]: any = await conn.query(
    "SELECT COUNT(*) AS n FROM users WHERE name LIKE ? AND status = ?",
    [`%${marker}%`, status],
  );
  return Number(rows[0].n);
}

console.log("\n#35 status 参数");

try {
  // 1. 不带 status = 全表
  await expectTotal("不带 status 时 total 是全部", "", () => countUsers());

  // 2. status=1 / status=0 = 库里对应状态的行数
  await expectTotal("status=1 的 total 等于库里 status=1 的行数", "?status=1", () => countUsers(1));
  await expectTotal("status=0 的 total 等于库里 status=0 的行数", "?status=0", () => countUsers(0));

  // 3. 非法值当没给：不报错、按不过滤处理
  for (const raw of ["abc", "2", "", "-1", "true"]) {
    const window = await inStableWindow(
      () => countUsers(),
      async () => {
        const unfiltered = await listUsers("");
        const dirty = await listUsers(`?status=${raw}`);
        return { unfiltered, dirty };
      },
    );
    if (!window) {
      check(`status=${JSON.stringify(raw)} 不报错且按不过滤处理`, false, "取不到稳定窗口");
      continue;
    }
    const { unfiltered, dirty } = window.result;
    check(
      `status=${JSON.stringify(raw)} 不报错且按不过滤处理`,
      unfiltered.status === 200 &&
        dirty.status === 200 &&
        dirty.total === window.count &&
        unfiltered.total === window.count,
      {
        unfilteredStatus: unfiltered.status,
        dirtyStatus: dirty.status,
        unfilteredTotal: unfiltered.total,
        dirtyTotal: dirty.total,
        dbCount: window.count,
      },
    );
  }

  // 4. status 与 keyword 组合：标记用户一正常一停用，marker 唯一所以不担心并发
  const both = await listUsers(`?keyword=${marker}`);
  check(`keyword=${marker} 单独用时两条都命中`, both.total === 2 && both.items.length === 2, {
    total: both.total,
    items: both.items.length,
  });

  const onlyActive = await listUsers(`?keyword=${marker}&status=1`);
  check(
    "status=1 与 keyword 组合只剩正常那条",
    onlyActive.total === 1 &&
      onlyActive.items.length === 1 &&
      onlyActive.items[0]?.id === activeId &&
      onlyActive.items[0]?.status === 1,
    { total: onlyActive.total, items: onlyActive.items.map((u: any) => [u.id, u.status]) },
  );

  const onlyBanned = await listUsers(`?keyword=${marker}&status=0`);
  check(
    "status=0 与 keyword 组合只剩停用那条",
    onlyBanned.total === 1 &&
      onlyBanned.items.length === 1 &&
      onlyBanned.items[0]?.id === bannedId &&
      onlyBanned.items[0]?.status === 0,
    { total: onlyBanned.total, items: onlyBanned.items.map((u: any) => [u.id, u.status]) },
  );

  await expectTotal("keyword+status=1 的 total 与 SQL 计数一致", `?keyword=${marker}&status=1`, () =>
    countMarker(1),
  );

  // 5. status 与分页：size=1 翻页时 total 仍是筛选后的总数
  const paging = await inStableWindow(
    () => countUsers(1),
    async () => {
      const page1 = await listUsers("?status=1&size=1&page=1");
      const page2 = await listUsers("?status=1&size=1&page=2");
      const beyond = await listUsers(`?status=1&size=1&page=99999`);
      return { page1, page2, beyond };
    },
  );
  if (!paging) {
    check("status 与分页组合", false, "取不到稳定窗口");
  } else {
    const { page1, page2, beyond } = paging.result;
    check(
      "size=1 翻页时 items 只有一条，但 total 是筛选后的总数",
      page1.items.length <= 1 &&
        page2.items.length <= 1 &&
        page1.total === paging.count &&
        page2.total === paging.count &&
        page1.total === page2.total,
      { page1: page1.total, page2: page2.total, dbCount: paging.count },
    );
    check(
      "越界页 items 为空、total 仍是筛选后的总数",
      beyond.items.length === 0 && beyond.total === paging.count,
      { total: beyond.total, items: beyond.items.length, dbCount: paging.count },
    );
  }
} finally {
  // 只删自己造的行
  if (madeIds.length > 0) {
    await conn.query(`DELETE FROM users WHERE id IN (${madeIds.map(() => "?").join(",")})`, madeIds);
  }
  if (tempAdminId > 0) await conn.query("DELETE FROM users WHERE id = ?", [tempAdminId]);
}

/* ------------------------------------------------ #37 静态检查：定义只剩一处 */

console.log("\n#37 数据层只有一份定义");

function collect(dir: string, out: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const sourceFiles = collect("src");
const typeDefs: string[] = [];
const fnDefs: string[] = [];
const reexportSites: string[] = [];
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, "utf-8");
  // 只看真正的定义；`export { AdminUser }` / `export { X } from "./..."` 这种转发不算
  if (/export\s+(?:type|interface)\s+AdminUser\b/.test(text)) typeDefs.push(file);
  if (/export\s+(?:function|const)\s+fetchAdminUsers\b/.test(text)) fnDefs.push(file);
  if (/export\s*\{[^}]*\b(?:AdminUser|fetchAdminUsers)\b[^}]*\}/.test(text)) reexportSites.push(file);
}

check("AdminUser 的类型定义全仓库只有一处", typeDefs.length === 1, typeDefs);
check("fetchAdminUsers 的函数定义全仓库只有一处", fnDefs.length === 1, fnDefs);
check(
  "唯一的定义在 admin-users.ts（正主）",
  typeDefs[0] === path.join("src", "lib", "admin-users.ts") &&
    fnDefs[0] === path.join("src", "lib", "admin-users.ts"),
  { typeDefs, fnDefs },
);
check(
  "admin-keys.ts 与 admin-notifications.ts 改成从 admin-users 转发",
  reexportSites.includes(path.join("src", "lib", "admin-keys.ts")) &&
    reexportSites.includes(path.join("src", "lib", "admin-notifications.ts")),
  reexportSites,
);

/* ------------------------------------------------------------------- 收尾 */

await conn.end();
console.log(`\n${passed} 通过，${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
