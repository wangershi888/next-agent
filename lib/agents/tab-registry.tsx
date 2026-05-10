"use client";

import type { ReactNode } from "react";
import { ArgumentAssistantTab } from "@/components/agents/ArgumentAssistantTab";
import { DeepAgentsChatTab } from "@/components/agents/DeepAgentsChatTab";
import { LangChainChatTab } from "@/components/agents/LangChainChatTab";
import { TradingDecisionTab } from "@/components/agents/TradingDecisionTab";

export interface AgentTabConfig {
  key: string;
  label: string;
  children: ReactNode;
}

export const agentTabs: AgentTabConfig[] = [
  {
    key: "deep-agents-chat",
    label: "Deep Agents 对话",
    children: <DeepAgentsChatTab />,
  },
  {
    key: "langchain-chat",
    label: "LangChain 对话",
    children: <LangChainChatTab />,
  },
  {
    key: "trading-agents",
    label: "多 Agent 交易决策",
    children: <TradingDecisionTab />,
  },
  {
    key: "argument-assistant",
    label: "论点编写助手（LangGraph）",
    children: <ArgumentAssistantTab />,
  },
];
