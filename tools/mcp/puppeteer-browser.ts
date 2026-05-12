import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { mcpStringProcessEnv, resolveMcpServerEntry } from "./resolve";

/**
 * 须与 `@langchain/mcp-adapters` 使用同一 `@modelcontextprotocol/sdk` 主版本，
 * 否则 stdio 握手会报 Connection closed。项目在 package.json 中用 `overrides` 统一 SDK。
 *
 * @see https://www.npmjs.com/package/@modelcontextprotocol/server-puppeteer
 */
export function resolveServerPuppeteerMcpEntry(): string {
  return resolveMcpServerEntry(
    "server-puppeteer",
    `未找到 Puppeteer MCP 入口。请在项目根目录执行 npm install @modelcontextprotocol/server-puppeteer`,
  );
}

export interface ServerPuppeteerMcpHandle {
  tools: Awaited<ReturnType<MultiServerMCPClient["getTools"]>>;
  close: () => Promise<void>;
}

/**
 * stdio 启动 Puppeteer MCP，并通过 `@langchain/mcp-adapters` 转为 LangChain Tools。
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
        env: mcpStringProcessEnv(),
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
