import { createAgent } from "langchain";
import { createQwenChatModel } from "../model/chat-models";
import { createTavilyWebSearchTool } from "../tools/web-search";

export interface LangChainChatAgentOptions {
  /** 是否注册 Tavily 工具（仍受 `TAVILY_API_KEY` 是否配置影响） */
  enableWebSearch: boolean;
}

export function createLangChainChatAgent(options: LangChainChatAgentOptions) {
  const model = createQwenChatModel();
  const tavilyKey = process.env.TAVILY_API_KEY;

  const tools =
    options.enableWebSearch && tavilyKey ? [createTavilyWebSearchTool(tavilyKey)] : [];

  return createAgent({
    model,
    tools,
  });
}
