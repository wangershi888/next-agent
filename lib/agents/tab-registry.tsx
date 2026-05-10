"use client";

import type { ReactNode } from "react";
import { LangChainChatTab } from "@/components/agents/LangChainChatTab";
import { PlaceholderAgentTab } from "@/components/agents/PlaceholderAgentTab";

export interface AgentTabConfig {
  key: string;
  label: string;
  children: ReactNode;
}

export const agentTabs: AgentTabConfig[] = [
  {
    key: "langchain-chat",
    label: "LangChain 对话",
    children: <LangChainChatTab />,
  },
  {
    key: "more",
    label: "更多 Agent（占位）",
    children: (
      <PlaceholderAgentTab
        title="更多 Agent Demo"
        description="后续每个 Tab 可挂载独立的 Agent 示例工程；当前为占位页。"
      />
    ),
  },
];
