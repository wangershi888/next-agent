# LangGraph（本项目）

本目录存放基于 `@langchain/langgraph` 的状态图编排实现，与 `frameworks/langchain` 下的线性 Chain 示例并列，突出 **循环（Cycles）**、**共享状态（State）** 与 **人工干预（Human-in-the-loop）**。

## 论点编写助手 Demo

- **图定义**：`graphs/argument-assistant-graph.ts`
- **HTTP**：`POST /api/agents/argument-assistant`（SSE，`text/event-stream`）
- **前端 Tab**：`components/agents/ArgumentAssistantTab.tsx`（注册于 `lib/agents/tab-registry.tsx`）

### 思想：线性 Chain vs LangGraph

| 维度 | LCEL / Runnable 链 | LangGraph `StateGraph` |
|------|---------------------|-------------------------|
| 控制流 | 多为单向流水线 | `addConditionalEdges` 支持分支与 **回到上游节点**（循环改写） |
| 数据传递 | 对象在步骤间传递 | `Annotation.Root` 声明 **共享状态**，各节点返回 **部分更新** |
| 人在回路 | 需在应用层手写暂停/恢复 | `interrupt()` + `MemorySaver` + `Command({ resume })` 一等公民 |

### 状态（State）

使用 `Annotation.Root` 描述频道（此处均为 LastValue，即最新值覆盖）：

- `topic` / `passThreshold` / `maxIterations`：用户输入与护栏
- `revisionCount` / `draft`：改写轮次与当前论点稿
- `score` / `scorerFeedback`：评分 Agent 输出
- `passed` / `passAdvice` / `aborted`：终态标记

### 节点（NODE）与边（EDGE）

- **`writer`**：通义千问，根据主题与上轮反馈生成 **短论点**（控制长度以节省 token）。
- **`scorer`**：通义千问，输出严格 JSON `{"score","feedback"}` 解析后写入状态。
- **`finalize_success`**：分数达标时生成简短「通过建议」。
- **`human_final`**：达到 `maxIterations` 仍未达标时调用 `interrupt(...)`，把末稿与分数交给前端；用户通过二次请求 `Command({ resume })` 选择 **强制采纳** 或 **放弃**。

边：

- `START → writer → scorer`
- `scorer` 后 **条件边**：达标 → `finalize_success → END`；未达标且未触顶 → **回到 `writer`（循环）**；未达标且已达轮数上限 → `human_final → END`（中间可能暂停在 interrupt）。

### 模型（阿里通义千问）

与项目其余 Agent 一致，经 `createQwenChatModel`（`frameworks/langchain/model/chat-models.ts`）使用 DashScope OpenAI 兼容端点；环境变量 **`DASHSCOPE_API_KEY`**，可选 **`QWEN_MODEL`**。

### API 约定（SSE）

请求体（JSON）：

1. **首轮**：`{ "phase": "start", "threadId": "<uuid>", "topic": "...", "passThreshold": 9, "maxIterations": 5 }`
2. **恢复中断**：`{ "phase": "resume", "threadId": "<同上>", "resume": { "action": "force_pass" } | { "action": "give_up" } }`

事件（每条 `data: {...}\\n\\n`）：

- `values`：完整状态快照（可用 `isInterrupted` 识别中断）
- `updates`：节点级部分更新
- `interrupt`：解析后的暂停载荷（前端展示按钮）
- `done` / `error`

服务端使用 **单例** `MemorySaver` + 客户端传入的 **`thread_id`**，保证跨两次 HTTP 请求仍能恢复同一线程的检查点。

### 参考

- [LangGraph JS 概览](https://docs.langchain.com/oss/javascript/langgraph/overview)
