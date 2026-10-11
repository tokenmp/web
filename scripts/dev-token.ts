/**
 * 开发用的会话签发小工具。
 *
 * 会话是无状态 JWT，所以验证接口时不用走登录流程，直接按 SESSION_SECRET 签一个
 * 带 sub / tv / role 的 token 就行 —— 不用去猜库里那几个管理员账号的密码。
 *
 *   bun scripts/dev-token.ts            # 挑一个可用的管理员
 *   bun scripts/dev-token.ts 319        # 指定用户 id
 *   bun scripts/dev-token.ts --curl      # 顺带打印一条 curl 命令
 *
 * 只在本地开发用，不要在生产环境跑。
 */
import { eq } from "drizzle-orm";

import { signSession } from "../src/lib/auth";
import { db } from "../src/lib/db";
import { users } from "../src/lib/schema";

const args = process.argv.slice(2);
const wantsCurl = args.includes("--curl");
const idArg = args.find(a => !a.startsWith("--"));
const id = idArg ? Number(idArg) : null;

const [row] = id
  ? await db.select().from(users).where(eq(users.id, id)).limit(1)
  : await db
      .select()
      .from(users)
      .where(eq(users.role, "admin"))
      .limit(1);

if (!row) {
  console.error(id ? `用户 ${id} 不存在` : "库里没有管理员账号");
  process.exit(1);
}
if (row.status !== 1) {
  console.error(`用户 ${row.id}（${row.name}）已停用，签出来的会话会被接口拒掉`);
  process.exit(1);
}

const token = await signSession({ sub: row.id, tv: row.tokenVersion, role: row.role });
console.log(`# ${row.id} ${row.name} <${row.email}> role=${row.role}`);
console.log(token);
if (wantsCurl) {
  console.log(`\ncurl -s -H 'Cookie: tokenmp_session=${token}' http://localhost:6789/api/auth/me | head -c 400`);
}

process.exit(0);
