"use client";

import { Tabs } from "antd";
import {
  ApiOutlined,
  BranchesOutlined,
  ClusterOutlined,
} from "@ant-design/icons";
import LangChainDemo from "./LangChainDemo";
import LangGraphDemo from "./LangGraphDemo";
import DeepAgentDemo from "./DeepAgentDemo";

export default function HomeTabs() {
  return (
    <Tabs
      defaultActiveKey="langchain"
      size="large"
      type="card"
      items={[
        {
          key: "langchain",
          label: (
            <span>
              <ApiOutlined /> LangChain · LCEL 多阶段
            </span>
          ),
          children: <LangChainDemo />,
        },
        {
          key: "langgraph",
          label: (
            <span>
              <BranchesOutlined /> LangGraph · 双 Agent 辩论
            </span>
          ),
          children: <LangGraphDemo />,
        },
        {
          key: "deepagent",
          label: (
            <span>
              <ClusterOutlined /> DeepAgent · 6 子 agent 调研
            </span>
          ),
          children: <DeepAgentDemo />,
        },
      ]}
    />
  );
}
