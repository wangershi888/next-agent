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

/** 论点助手：首轮运行 */
export interface ArgumentAssistantStartBody {
  threadId: string;
  topic: string;
  /** 满分 10，默认 9 */
  passThreshold?: number;
  /** 最大改写轮数（writer→scorer 记一轮），默认 5 */
  maxIterations?: number;
}

/** 论点助手：从中断恢复（Human-in-the-loop） */
export interface ArgumentAssistantResumeBody {
  threadId: string;
  resume: ArgumentAssistantHumanFinalResume;
}

export type ArgumentAssistantHumanFinalResume =
  | { action: "force_pass" }
  | { action: "give_up" };

export type ArgumentAssistantRequestBody =
  | ({ phase: "start" } & ArgumentAssistantStartBody)
  | ({ phase: "resume" } & ArgumentAssistantResumeBody);
