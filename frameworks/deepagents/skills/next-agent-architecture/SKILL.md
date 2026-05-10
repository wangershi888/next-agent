---
name: next-agent-architecture
description: 说明 next-agent 多 Tab 架构、API 路径与扩展方式，用于回答「功能在代码哪里」类问题。
---

# Next Agent 项目速查

## 入口与 Tab
- Tab 列表：`lib/agents/tab-registry.tsx`
- 首页：`app/page.tsx`（Ant Design `Tabs`）

## 已有 API
- LangChain 对话流：`POST /api/agents/langchain-chat`
- Deep Agents 对话流：`POST /api/agents/deep-chat`
- 交易决策、论点助手等见各自 `app/api/agents/*`

## 扩展新 Demo
1. 在 `components/agents` 增加 Tab 组件
2. 在 `app/api/agents` 增加路由（建议 `runtime = "nodejs"`）
3. 把 Tab 注册进 `agentTabs`
