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
              <ApiOutlined /> LangChain · LCEL 链
            </span>
          ),
          children: <LangChainDemo />,
        },
        {
          key: "langgraph",
          label: (
            <span>
              <BranchesOutlined /> LangGraph · 反思状态图
            </span>
          ),
          children: <LangGraphDemo />,
        },
        {
          key: "deepagent",
          label: (
            <span>
              <ClusterOutlined /> DeepAgent · 多智能体规划
            </span>
          ),
          children: <DeepAgentDemo />,
        },
      ]}
    />
  );
}
