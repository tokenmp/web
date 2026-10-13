/**
 * CI 用：把 db/init 下的建表脚本按文件名顺序灌进空库，再补一条测试用的管理员。
 *
 *   DATABASE_URL=mysql://root:root@127.0.0.1:3306/tokenmp bun scripts/ci-init-db.ts
 *
 * 为什么要有这个脚本：.github/workflows/ci.yml 里的 MySQL 用的是 service 容器，
 * 它不认 `docker-entrypoint-initdb.d`（那个只在 `docker run` 时由入口脚本执行），
 * 所以服务容器不会自己建表。本地`docker compose up` 走的是入口脚本那条路，
 * 与自己灌库的结果必须一致 —— 两边都是把同一份 db/init 交给 MySQL 执行。
 *
 * 两处注意：
 *   - 用 multipleStatements 一次发整个文件：脚本里有 `SET @x = (...)` +
 *     `PREPARE stmt FROM @x` 这种跨语句的会话变量，逐句发也能跑，但一次发少一轮往返，
 *     且与入口脚本的行为更接近。
 *   - 建表脚本开头自带 `SET NAMES utf8mb4`（见 db/init/01-schema.sql 的说明），
 *     所以这里不用再管字符集，中文种子数据不会变成乱码。
 *
 * 管理员那条是测试的前提：tests/api.test.ts 的 beforeAll 要挑一个 role='admin'
 * 的用户来签会话，库是空的它就没得挑。密码用固定串，登录不了也没关系 ——
 * 测试是直接签 JWT，不走登录。
 */
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("没有 DATABASE_URL，先给一个能连上的库。");
  process.exit(1);
}

const dir = path.join(import.meta.dirname, "..", "db", "init");
const files = fs
  .readdirSync(dir)
  .filter(name => name.endsWith(".sql"))
  .sort();

const conn = await mysql.createConnection({ uri: url, multipleStatements: true });

for (const file of files) {
  await conn.query(fs.readFileSync(path.join(dir, file), "utf8"));
  console.log(`[建库] ${file}`);
}

// 测试要一个管理员。already exists 就跳过，脚本可以重复跑
const [admins] = (await conn.query(
  "SELECT id FROM users WHERE role = 'admin' LIMIT 1",
)) as [Array<{ id: number }>, unknown];

if (admins.length === 0) {
  await conn.query(
    "INSERT INTO users (name, email, password_hash, role, status, credit_limit, balance, credit_used, token_version, source) " +
      "VALUES ('ci-admin', 'ci-admin@example.com', 'ci-not-a-real-hash', 'admin', 1, 0, 0, 0, 0, 'local')",
  );
  console.log("[建库] 补了一条管理员 ci-admin，给测试签会话用");
}

const [plans] = (await conn.query("SELECT COUNT(*) AS n FROM plans")) as [
  Array<{ n: number }>,
  unknown,
];
console.log(`[建库] 完成：${files.length} 个脚本，${plans[0].n} 条种子套餐`);

await conn.end();
process.exit(0);
