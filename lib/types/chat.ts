export type ChatRole = "user" | "assistant";

export interface UiChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

export interface LangChainChatRequestBody {
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  enableWebSearch: boolean;
}

export interface TradingDecisionRequestBody {
  stockCode: string;
}
