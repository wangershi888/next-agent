import { createAgent } from "langchain";
import { createQwenChatModel } from "../model/chat-models";
import {
  type ServerPuppeteerMcpHandle,
  loadServerPuppeteerMcpTools,
} from "../mcp/server-puppeteer-mcp";
import { createTavilyWebSearchTool } from "../tools/web-search";

export interface LangChainChatAgentOptions {
  /** 是否注册 Tavily 工具（仍受 `TAVILY_API_KEY` 是否配置影响） */
  enableWebSearch: boolean;
}

export interface LangChainChatAgentBundle {
  agent: ReturnType<typeof createAgent>;
  dispose: () => Promise<void>;
}

export async function createLangChainChatAgent(
  options: LangChainChatAgentOptions,
): Promise<LangChainChatAgentBundle> {
  const model = createQwenChatModel();
  const tavilyKey = process.env.TAVILY_API_KEY;

  const localTools =
    options.enableWebSearch && tavilyKey ? [createTavilyWebSearchTool(tavilyKey)] : [];

  const browserMcp: ServerPuppeteerMcpHandle = await loadServerPuppeteerMcpTools();
  const mcpTools = browserMcp.tools;

  const agent = createAgent({
    model,
    tools: [...localTools, ...mcpTools],
  });

  return {
    agent,
    dispose: async () => {
      await browserMcp.close();
    },
  };
}
