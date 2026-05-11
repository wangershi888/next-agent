# 交易决策链路中的 LangChain / LCEL 知识点

本文档对应实现文件：**`trading-decision-chain.ts`**，以及与工具相关的 **`tools/eastmoney-tools.ts`**、模型 **`frameworks/langchain/model/chat-models.ts`**。

---

## 1. LCEL（LangChain Expression Language）是什么

LCEL 是 LangChain 里用 **Runnable** 组合逻辑的方式：通过 **`pipe`** 或 **`RunnableSequence`** 把「提示词 → 模型 → 下一步」声明式串起来，而不是手写一大段顺序脚本。

本项目中：**整条流水线**和**每个 Agent 内部的「提示词 + 模型」**都用到了这种组合方式。

---

## 2. Runnable：可组合的最小单元

- **含义**：实现了统一接口（如 `invoke`）的对象，都可以在链里当作一环使用。
- **在本项目中**：`normalizeStep`、`dataAnalystStep`、…… 以及内部的 `miniChain`（见下）都是 Runnable。
- **文档导向**：只要记住「凡是要接进 `RunnableSequence` 或 `.pipe()` 里的，都是 Runnable」。

---

## 3. RunnableLambda：把普通函数变成链上节点

- **API**：`RunnableLambda.from(async (input) => output)`（见 `@langchain/core/runnables`）。
- **作用**：把任意异步函数包装成 Runnable，用于**非 LLM 步骤**（如规范化股票代码）或**「先调工具 + 再跑子链」**的复合步骤。
- **在本项目中**：
  - `normalizeStep`：纯逻辑，无模型。
  - `dataAnalystStep` / `technicalAnalystStep` 等：内部先 `newsTool.invoke` / `marketTool.invoke`，再 `miniChain.invoke`，最后把结果写回状态对象。

---

## 4. RunnableSequence：顺序执行多段 Runnable

- **API**：`RunnableSequence.from([r1, r2, r3, ...])`。
- **语义**：输出依次传递：`r1` 的输出作为 `r2` 的输入，以此类推。
- **在本项目中**：
  - **主链**：`RunnableSequence.from([normalizeStep, dataAnalystStep, technicalAnalystStep, riskStep, tradingAgentStep])`。
  - **子链**：每个 Agent 内 `RunnableSequence.from([prompt, model])`，表示「先渲染提示词，再调用聊天模型」。

---

## 5. pipe：与 RunnableSequence 等价的链式写法

- **API**：`r1.pipe(r2).pipe(r3)...`（Runnable 实例方法）。
- **关系**：在 LangChain 中，**`a.pipe(b).pipe(c)` 与 `RunnableSequence.from([a,b,c])` 语义等价**（同一组 Runnable 时）。
- **在本项目中**：`buildTradingDecisionRunnable()` 返回的 **`pipedChain`** 即用 `normalizeStep.pipe(dataAnalystStep).pipe(...)` 展示这种写法，便于对照阅读。

---

## 6. ChatPromptTemplate：可参数化的提示词模板

- **API**：`ChatPromptTemplate.fromMessages([["system", "..."], ["human", "..."]])`，占位符如 `{code}`、`{news}`。
- **作用**：把「角色设定 + 用户/上下文」从字符串里拆出来，运行时用 `invoke({ code, news, ... })` 填入。
- **在本项目中**：数据/技术/风控/交易四个 Agent 各有一套 `fromMessages`；风控与交易步还依赖前序节点写入 state 的字段（如 `data`、`tech`、`risk`）。

---

## 7. ChatModel（通义千问 via OpenAI 兼容接口）

- **实现**：`@langchain/openai` 的 **`ChatOpenAI`**，在 **`createQwenChatModel()`** 中配置 `baseURL` 指向阿里云 DashScope 兼容端点。
- **在本项目中**：
  - 交易链使用 **`createQwenChatModel({ streaming: false, temperature: 0.35 })`**，便于 `invoke` 一次取完整 **AIMessage**，适合「步骤落库 / SSE 推送」场景。
  - 与「对话 Tab」里默认 `streaming: true` 的用法形成对比：同一套模型类，不同调用参数。

---

## 8. LCEL 子链：`ChatPromptTemplate` + `ChatModel`

- **写法**：`RunnableSequence.from([prompt, model])`。
- **等价理解**：**`prompt.pipe(model)`**（LangChain 中 ChatPromptTemplate 与 ChatModel 均为 Runnable，可直接 pipe）。
- **在本项目中**：每个「分析师 / 风控 / 交易」步骤里的 **`miniChain`** 都是这种 **「模板 → 模型」** 的二元序列；输出为 **`AIMessage`**，再通过自定义函数 `aimessageText` 转成纯文本写入 `TradingPipelineState`。

---

## 9. AIMessage 与多模态 content

- **类型**：`@langchain/core/messages` 的 **`AIMessage`**。
- **注意**：`content` 可能是 **字符串**，也可能是 **内容块数组**（多模态或流式拼接）；本项目的 **`aimessageText`** 对二者做了兼容，保证写入 state 的是字符串。

---

## 10. Tool（Structured Tool）与 `invoke`

- **创建方式**：`langchain` 包提供的 **`tool(...)`**，配合 **Zod** `schema` 描述参数（见 `eastmoney-tools.ts`）。
- **在本项目中**：工具不在「自动 Agent 循环」里由模型反复调用，而是由 **`RunnableLambda` 内显式 `await newsTool.invoke({ stock_code })`**，再交给 LLM 分析——这是 **「工具 + LCEL 链」手动编排** 的典型用法。
- **知识点**：Tool 在 LangChain 中也可视为可调用的 Runnable；**`invoke` 入参与 schema 一致**。

---

## 11. withConfig：运行名 / 追踪元数据

- **API**：`.withConfig({ runName: "..." })` 挂在 Runnable 上。
- **作用**：在 LangSmith 等追踪场景下区分步骤；本项目中用于标注节点名（如 `node_data_analyst_agent`、`lcel_prompt_pipe_model_data_analyst`），便于日志与调试。

---

## 12. 状态传递模式：单对象累积（Reducer 思想）

- **类型**：`TradingPipelineInput` → `TradingPipelineState`（后者逐步填充 `newsToolOutput`、`dataAnalyst` 等）。
- **与 LangGraph 的区别**：这里未使用 LangGraph 的 StateGraph，而是用 **同一 shape 的对象**在 Runnable 间传递，适合线性多步流水线。

---

## 13. 与本仓库「LangChain 对话」Tab 的差异（对照学习）

| 维度 | 交易决策链（本 README） | LangChain 对话（`createAgent`） |
|------|-------------------------|----------------------------------|
| 编排方式 | 手写 `RunnableSequence` / `pipe` + `RunnableLambda` | `createAgent({ model, tools })` 内置 ReAct 类循环 |
| 工具调用 | 代码里显式 `tool.invoke` | 通常由 Agent 根据对话决定何时调工具 |
| 适用场景 | 固定业务步骤（先资讯 → 再行情 → 风控 → 摘要） | 开放域多轮对话 |

---

## 14. 相关文件索引

| 文件 | 说明 |
|------|------|
| `trading-decision-chain.ts` | LCEL 主链与各 Runnable 节点定义 |
| `tools/eastmoney-tools.ts` | `tool()` + Zod，供链内 `invoke` |
| `../model/chat-models.ts` | `ChatOpenAI`（通义千问） |
| `../../../app/api/agents/trading-decision/route.ts` | 按步骤 `invoke` 并 SSE 输出，便于观察每一步 |

---

## 15. 延伸阅读（官方概念）

- **LCEL**：Runnable、pipe、RunnableSequence、RunnableLambda。
- **Prompts**：`ChatPromptTemplate`。
- **Chat models**：`@langchain/openai` 等与 LangChain 集成的模型类。
- **Tools**：结构化工具与 `invoke` / 绑定到 Agent 的差异。

以上知识点均已在本交易分析流水线中有对应代码落点，阅读 **`trading-decision-chain.ts`** 即可对照。
