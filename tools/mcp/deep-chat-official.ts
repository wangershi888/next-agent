import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { mcpStringProcessEnv, resolveMcpServerEntry } from "./resolve";

export interface DeepChatMcpHandle {
  tools: Awaited<ReturnType<MultiServerMCPClient["getTools"]>>;
  close: () => Promise<void>;
}

/**
 * 为 Deep Chat 加载若干官方 MCP（memory / sequential-thinking / filesystem）。
 * - 设置 `DEEP_CHAT_MCP=0` 或 `false` 可关闭。
 * - `host_filesystem` 仅允许访问 `process.cwd()`，与 Deep Agents 虚拟盘互补；工具名带服务器前缀，避免与内置 `write_file` 等冲突。
 */
export async function loadDeepChatMcpTools(): Promise<DeepChatMcpHandle | null> {
  const off = process.env.DEEP_CHAT_MCP;
  if (off === "0" || off === "false") return null;

  let client: MultiServerMCPClient | undefined;
  try {
    const cwd = process.cwd();
    const memoryEntry = resolveMcpServerEntry("server-memory");
    const thinkEntry = resolveMcpServerEntry("server-sequential-thinking");
    const fsEntry = resolveMcpServerEntry("server-filesystem");
    const env = mcpStringProcessEnv();

    client = new MultiServerMCPClient({
      mcpServers: {
        memory: {
          transport: "stdio",
          command: process.execPath,
          args: [memoryEntry],
          cwd,
          env,
        },
        sequential_thinking: {
          transport: "stdio",
          command: process.execPath,
          args: [thinkEntry],
          cwd,
          env,
        },
        host_filesystem: {
          transport: "stdio",
          command: process.execPath,
          args: [fsEntry, cwd],
          cwd,
          env,
        },
      },
      onConnectionError: "ignore",
      prefixToolNameWithServerName: true,
      throwOnLoadError: false,
    });

    const tools = await client.getTools();
    if (!tools.length) {
      await client.close();
      return null;
    }

    return {
      tools,
      close: () => client!.close(),
    };
  } catch (e) {
    console.error("[tools/mcp/deep-chat-official] load failed:", e);
    if (client) await client.close().catch(() => {});
    return null;
  }
}
