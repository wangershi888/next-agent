import fs from "node:fs";
import path from "node:path";

/**
 * 解析 `@modelcontextprotocol/<packageDir>` 的 stdio 入口（`dist/index.js`）。
 * 使用 `process.cwd()` + `node_modules` 固定拼接，避免 Next 打包后对 `createRequire` 路径解析异常。
 */
export function resolveMcpServerEntry(packageDir: string, notFoundMessage?: string): string {
  const entry = path.join(
    process.cwd(),
    "node_modules",
    "@modelcontextprotocol",
    packageDir,
    "dist",
    "index.js",
  );
  if (!fs.existsSync(entry)) {
    throw new Error(
      notFoundMessage ??
        `未找到 MCP 包 @modelcontextprotocol/${packageDir}：${entry}`,
    );
  }
  return entry;
}

/** 子进程继承用：仅保留值为 string 的环境变量（MultiServerMCPClient stdio 要求）。 */
export function mcpStringProcessEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
}
