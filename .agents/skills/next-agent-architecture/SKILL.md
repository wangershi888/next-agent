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

## 共享 Skills 与 Tools
- **Skills（磁盘）**：`.agents/skills/<slug>/` 与官方 CLI `npx skills add … -a deepagents` 一致；运行时由 `CompositeBackend` 挂载为虚拟路径 `/skills/...`（读磁盘即生效）。`write/edit` 对 `/skills/**` 被禁止以保护仓库。
- **从 GitHub 安装 Skill**：在项目根执行  
  `npx skills add <owner/repo> -a deepagents -y --copy`  
  例：`npx skills add alchaincyf/nuwa-skill -a deepagents -y --copy`  
  也可用 `npm run skills:add -- alchaincyf/nuwa-skill -a deepagents -y --copy`。安装前可用 `npx skills add <repo> -l` 查看包内有哪些 skill。
- **Tools**：`tools/*.ts` 为可复用的 LangChain `tool()` 封装，通过 `@/tools/...` 引用。

## 扩展新 Demo
1. 在 `components/agents` 增加 Tab 组件
2. 在 `app/api/agents` 增加路由（建议 `runtime = "nodejs"`）
3. 把 Tab 注册进 `agentTabs`
