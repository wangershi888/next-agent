# LangGraph Demo · 反思式短文生成

这个 demo 展示 **LangGraph** 最经典的 "Reflection" 范式：
模型先写一稿，编辑给出评分 + 修改建议，**没达标就回到生成节点继续改**，
直到达标或用完次数。突出 LangGraph 相对于线性 LCEL 的核心优势 —— **可循环、有条件分支的状态机**。

## 图结构

```
              ┌──────────┐
              │  START   │
              └────┬─────┘
                   ▼
              ┌──────────┐
       ┌────▶ │ generate │
       │      └────┬─────┘
       │           ▼
       │      ┌──────────┐
       │      │ critique │
       │      └────┬─────┘
       │           ▼
       │      ┌──────────┐
       │      │ decide   │  (条件边)
       │      └────┬─────┘
       │           │ score < target & 还有预算
       └───────────┘
                   │ 否则
                   ▼
                  END
```

## 关键代码（精简版）

```ts
const State = Annotation.Root({
  topic: Annotation<string>(),
  drafts: Annotation<string[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  critiques: Annotation<Critique[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  iteration: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
});

const graph = new StateGraph(State)
  .addNode("generate", generateNode)
  .addNode("critique", critiqueNode)
  .addEdge(START, "generate")
  .addEdge("generate", "critique")
  .addConditionalEdges("critique", decideRoute, {
    generate: "generate",   // 不达标 → 回到生成
    [END]: END,             // 达标或预算用尽
  })
  .compile();
```

## 演示要点

- **状态机驱动**：`Annotation.Root` 显式定义状态，节点是 `(state) => Partial<state>`。
- **可循环**：`addConditionalEdges` 让 `critique → generate` 形成闭环，这是 LCEL 做不到的。
- **流式可观测**：`graph.stream(input, { streamMode: "updates" })` 把每个节点的局部更新推给前端，UI 可以实时呈现「第几轮迭代、当前评分、新草稿」。

## 涉及文件

- [`graph.ts`](./graph.ts) —— Graph 定义
- `app/api/langgraph/route.ts` —— SSE 流式接口
- `components/LangGraphDemo.tsx` —— 前端 UI（多迭代卡片 + 步骤条）
