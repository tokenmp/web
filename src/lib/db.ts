import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

import * as schema from "./schema";

/**
 * 连的是 docker compose 起的本地 MySQL（见项目根的 docker-compose.yml，映射在 3307）。
 * 容器给的默认账号密码写在下面的兜底值里，覆盖的话在 .env 里设 DATABASE_URL。
 */
const url =
  process.env.DATABASE_URL ?? "mysql://tokenmp:tokenmp-dev@127.0.0.1:3307/tokenmp";

// 容器启动时设了 --default-time-zone=+00:00，这里也按 UTC 解析，
// 免得 datetime 字段在读写时被本地时区隐式偏移。
const pool = mysql.createPool({
  uri: url,
  connectionLimit: 5,
  timezone: "Z",
  supportBigNumbers: true,
  bigNumberStrings: false,
});

export const db = drizzle(pool, { schema, mode: "default" });
export { schema };
export { pool };
