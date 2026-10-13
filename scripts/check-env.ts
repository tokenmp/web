/**
 * 启动前的配置检查。
 *
 * 起因是一次部署后测试：用 `NODE_ENV=production node .output/server/index.mjs` 起服务，
 * 进程正常监听、日志里一句提示都没有，直到有人点登录才 500，报「生产环境必须设置 SESSION_SECRET」。
 * 根因是 node 不读 .env（bun 会），`bun run start` 里那个 node 子进程同样拿不到。
 *
 * 所以启动前先查一遍：缺什么、错什么，当场说清楚再退出，不要让服务带病监听。
 * 挂成 package.json 的 prestart，`bun run start` 会自动先跑它。
 *
 *   node scripts/check-env.ts
 *   SKIP_ENV_CHECK=1 bun run start     # 明确跳过（仅用于本地排查）
 *
 * 用 node 跑而不是 bun：容器里（Dockerfile 的运行段）只有 node，没有 bun。
 *
 * 生产上用 systemd 或容器注入环境变量时，这个检查同样有效 —— 它只看进程环境，
 * 不要求 .env 文件存在。
 */
// 运行时用 bun 跑时 mysql2 从 node_modules 来；node 跑时也一样，所以这里不做动态加载。
// 注意这一行是 prestart 依赖 node_modules 的唯一原因，Dockerfile 里为此专门装了一份 mysql2。
import mysql from "mysql2/promise";

const problems: string[] = [];
const warnings: string[] = [];

const isProduction = process.env.NODE_ENV === "production";
const DEFAULT_SECRET = "tokenmp-dev-secret-change-me";

/* ------------------------------------------------------------ SESSION_SECRET */

const secret = process.env.SESSION_SECRET;
if (!secret) {
  problems.push(
    "SESSION_SECRET 没有设置。它会签会话 cookie，线上必须给一个随机值：\n" +
      "    openssl rand -hex 32\n" +
      "  放进 .env，或者由部署环境注入。",
  );
} else if (secret === DEFAULT_SECRET) {
  if (isProduction) {
    // auth.ts 里也有这道判断，但那时已经晚了 —— 服务已经起来了
    problems.push("NODE_ENV=production 时 SESSION_SECRET 不能用默认值，换一个随机串。");
  } else {
    warnings.push("SESSION_SECRET 还是默认值，只有本地开发能这样。");
  }
} else if (secret.length < 32) {
  warnings.push(`SESSION_SECRET 只有 ${secret.length} 个字符，建议 32 位以上。`);
}

/* ------------------------------------------------------------- DATABASE_URL */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  warnings.push("DATABASE_URL 没设，会用 src/lib/db.ts 里写死的本地开发地址（127.0.0.1:3307）。");
} else if (isProduction && /127\.0\.0\.1|localhost/.test(databaseUrl)) {
  warnings.push("DATABASE_URL 指向本机，确认这是有意的。");
}

/* ---------------------------------------------------------- 内部回调密钥 */

// 两把密钥各保护一组内部端点（见 src/lib/callback-secret.ts）。本地不配也能跑
// （非生产环境放行），但生产必须配齐；缺哪一把，哪一组端点就全被拒。
const callbackSecrets: { name: string; missing: string }[] = [
  {
    name: "RECORDS_CALLBACK_SECRET",
    missing: "转发内核的记录摄入与客户端密钥校验会被全部拒绝",
  },
  {
    name: "RECHARGE_CALLBACK_SECRET",
    missing: "充值渠道回调会被全部拒绝，充值接不进账",
  },
];

for (const { name, missing } of callbackSecrets) {
  const value = process.env[name];
  if (!value) {
    if (isProduction) {
      problems.push(`${name} 没有设置。生产环境下${missing}，先补上。`);
    } else {
      warnings.push(`${name} 没设，它保护的端点只在非生产环境放行。`);
    }
  } else if (isProduction && value === "change-me") {
    problems.push(`NODE_ENV=production 时 ${name} 不能用示例值。`);
  }
}

/* --------------------------------------------------------------- 连通性 */

const url = databaseUrl ?? "mysql://tokenmp:tokenmp-dev@127.0.0.1:3307/tokenmp";
try {
  const conn = await mysql.createConnection({ uri: url, connectTimeout: 3000 });
  // 建表脚本没跑过的话，服务起来也是每个请求都报错，这里一并挡掉
  const [rows] = (await conn.query("SHOW TABLES")) as [Array<Record<string, string>>, unknown];
  const tables = new Set(rows.map(row => Object.values(row)[0]));
  for (const table of ["users", "plans", "credit_transactions"]) {
    if (!tables.has(table)) {
      problems.push(`库里没有 ${table} 表，先跑一遍 db/init 下的建表脚本。`);
    }
  }
  await conn.end();
} catch (err) {
  problems.push(`连不上数据库：${err instanceof Error ? err.message : String(err)}`);
}

/* ------------------------------------------------------------------ 输出 */

for (const w of warnings) console.warn(`[配置检查] 提醒：${w}`);

if (problems.length) {
  console.error("\n[配置检查] 启动前检查没通过，服务不会起来：\n");
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}

console.log("[配置检查] 通过");
process.exit(0);
