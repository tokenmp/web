/**
 * 路由文件的结构守卫。
 *
 * 起因：`src/routes/panel/me.tsx` 里的默认导出写成了
 * `export default function PanelMe() { ... }`，oxc-parser 把它误判成**类型导出**，
 * 而 SolidStart 的路由扫描会把 `isType` 的条目过滤掉 —— 结果是这条路由被悄悄丢掉：
 * 页面 404，构建日志里一句警告都没有，只是少了一条路由。
 *
 * 这种失败方式太安静，所以用这条测试盯着：所有页面文件必须能被解析出默认导出，
 * 所有 API 文件必须能被解析出至少一个 HTTP 方法导出。
 *
 * 解析器与 SolidStart 用的是同一个（oxc-parser），所以这里认不出来，
 * 路由器那边也认不出来。
 *
 *   bun test tests/routes.test.ts
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";

const ROUTES_DIR = "src/routes";
const HTTP_METHODS = ["HEAD", "GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"] as const;

/** 递归收集路由目录下的所有源码文件 */
function collect(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 按 SolidStart 的口径取「路由器能看见」的导出名 */
function visibleExports(file: string) {
  const source = fs.readFileSync(file, "utf-8");
  const parsed = parseSync(file, source, { lang: "tsx" });
  const entries = parsed.module.staticExports
    .flatMap(group => group.entries)
    // 关键：isType 的条目会被路由扫描丢掉，所以这里也按丢掉处理
    .filter(entry => !entry.isType && entry.exportName.kind !== "None");
  return {
    names: entries.map(entry => entry.exportName.name ?? "default"),
    parseErrors: parsed.errors?.length ?? 0,
  };
}

const files = collect(ROUTES_DIR);

describe("路由文件的结构", () => {
  test("路由目录下有文件可扫", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  test("每个文件都能被解析，没有语法错误", () => {
    const broken = files.filter(file => visibleExports(file).parseErrors > 0);
    expect(broken).toEqual([]);
  });

  test("页面文件都有能被识别的默认导出", () => {
    const missing: string[] = [];
    for (const file of files) {
      // api 目录下是 HTTP handler，不走默认导出
      if (file.includes(`${path.sep}api${path.sep}`)) continue;
      const { names } = visibleExports(file);
      if (!names.includes("default")) {
        missing.push(
          `${file} —— 没能解析出默认导出。` +
            `若文件里写的是 \`export default function X()\`，oxc-parser 可能把它误判成类型导出，` +
            `改成先声明再在文件末尾 \`export default X;\``,
        );
      }
    }
    expect(missing).toEqual([]);
  });

  test("API 文件都有能被识别的 HTTP 方法导出", () => {
    const missing: string[] = [];
    for (const file of files) {
      if (!file.includes(`${path.sep}api${path.sep}`)) continue;
      const { names } = visibleExports(file);
      const hasHandler = names.some(name => (HTTP_METHODS as readonly string[]).includes(name));
      if (!hasHandler) {
        missing.push(`${file} —— 没有 GET/POST/PUT/PATCH/DELETE 之类的导出`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("路由目录里不放纯工具模块", () => {
    // 既没有默认导出、也没有 HTTP 方法导出的，多半是被误放进来的助手模块。
    // SolidStart 会把它当路由文件扫一遍（虽然不会生成路由），该挪到 src/lib 下。
    const helpers: string[] = [];
    for (const file of files) {
      const { names } = visibleExports(file);
      const isApi = file.includes(`${path.sep}api${path.sep}`);
      const hasDefault = names.includes("default");
      const hasHandler = names.some(name => (HTTP_METHODS as readonly string[]).includes(name));
      if (!hasDefault && !hasHandler) {
        helpers.push(`${file} —— 既不像页面也不像接口，挪到 src/lib/ 下`);
      }
      void isApi;
    }
    expect(helpers).toEqual([]);
  });
});
