import fs from "node:fs";
import path from "node:path";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

/**
 * 须与 `@langchain/mcp-adapters` 使用同一 `@modelcontextprotocol/sdk` 主版本，
 * 否则 stdio 握手会报 Connection closed。项目在 package.json 中用 `overrides` 统一 SDK。
 */

/**
 * 解析 npm 包 `@modelcontextprotocol/server-puppeteer` 的入口脚本（与 package.json `bin.mcp-server-puppeteer` 一致）。
 *
 * 使用 `process.cwd()` + `node_modules` 固定拼接，避免：
 * - `createRequire(import.meta.url)` 在 Next 打包后指向 `(rsc)/` 虚拟目录；
 * - `createRequire(path.join(cwd, \"package.json\"))` 触发 webpack 对 `createRequire` 参数的静态分析告警。
 *
 * @see https://www.npmjs.com/package/@modelcontextprotocol/server-puppeteer
 */
export function resolveServerPuppeteerMcpEntry(): string {
  const entry = path.join(
    process.cwd(),
    "node_modules",
    "@modelcontextprotocol",
    "server-puppeteer",
    "dist",
    "index.js",
  );
  if (!fs.existsSync(entry)) {
    throw new Error(
      `未找到 Puppeteer MCP 入口：${entry}。请在项目根目录执行 npm install @modelcontextprotocol/server-puppeteer`,
    );
  }
  return entry;
}

export interface ServerPuppeteerMcpHandle {
  tools: Awaited<ReturnType<MultiServerMCPClient["getTools"]>>;
  close: () => Promise<void>;
}

/**
 * stdio 启动上述 MCP 服务，并通过 `@langchain/mcp-adapters` 转为 LangChain Tools。
 * 请求结束后须调用 `close()`。
 */
export async function loadServerPuppeteerMcpTools(): Promise<ServerPuppeteerMcpHandle> {
  const entry = resolveServerPuppeteerMcpEntry();
  const client = new MultiServerMCPClient({
    mcpServers: {
      browser: {
        transport: "stdio",
        command: process.execPath,
        args: [entry],
        cwd: process.cwd(),
        /** 继承当前进程环境（含 Next 加载的 .env），便于 PUPPETEER_EXECUTABLE_PATH 等生效 */
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
      },
    },
    onConnectionError: "throw",
  });

  const tools = await client.getTools("browser");

  return {
    tools,
    close: () => client.close(),
  };
}
