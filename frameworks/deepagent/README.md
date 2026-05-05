# DeepAgent Demo · 多智能体旅行规划师

这个 demo 演示 **DeepAgent 四件套** 在一次任务里如何协同工作：

| 能力 | 工具 | 在本 demo 里的角色 |
| --- | --- | --- |
| 规划 | `write_todos` | 主 Agent 接到任务先写一份 TODO 清单 |
| 子 Agent | `task` | 把"景点 / 美食 / 出行"分别委派给三个专属子 Agent |
| 文件系统 | `write_file` | 把整理好的最终方案写入 `trip-plan.md` |
| 详细系统提示 | `systemPrompt` | 强约束工作流，避免主 Agent 跳步 |

## 关键代码（精简版）

```ts
const subagents: SubAgent[] = [
  { name: "attractions-expert", description: "...", systemPrompt: "..." },
  { name: "cuisine-expert",     description: "...", systemPrompt: "..." },
  { name: "logistics-expert",   description: "...", systemPrompt: "..." },
];

const agent = createDeepAgent({
  model: new ChatDeepSeek({ model: "deepseek-v4-pro" }),
  systemPrompt: SYSTEM_PROMPT, // 强约束 4 步工作流
  subagents,
});

const stream = await agent.stream(
  { messages: [{ role: "user", content: userMessage }] },
  { streamMode: "updates" },
);
```

## 演示要点

- **TODO 面板**：左上角 `规划工具 · TODO List` 实时反映主 Agent 的 TODO 状态变化（pending → in_progress → completed）。
- **子 Agent 委派**：右侧活动流出现紫色 `task(...)` 时，就是主 Agent 正在调用某个子 Agent。
- **文件系统**：左下角 `文件系统 · Files` 会在工作流末尾出现 `trip-plan.md`，里面是结构化的最终方案。
- **上下文隔离**：因为子 Agent 各自有独立 context，主 Agent 的对话窗口不会被景点 / 美食的中间细节塞满，演示了 DeepAgent 的核心价值。

## 注意事项

- DeepAgent 内置工具（`write_todos`、`write_file`、`task`）默认使用 `StateBackend`（内存），刷新页面或重启进程后状态会丢失。
- 这里把模型设为 `deepseek-v4-pro`，因为它支持工具调用且对长链路推理更稳。
  如需更便宜的版本，可以改成 `deepseek-v4-flash`。
- 这次演示没有挂任何外部检索工具，回答完全由模型自身世界知识生成；
  生产中通常会再叠加 `internet_search`、向量库 retriever 等真实工具。

## 涉及文件

- [`agent.ts`](./agent.ts) —— 主 Agent + 三个子 Agent 定义
- `app/api/deepagent/route.ts` —— SSE 流式接口（把 TODO / 文件 / 工具调用都序列化下发）
- `components/DeepAgentDemo.tsx` —— 前端 UI（TODO + 文件 + 活动流三栏布局）
