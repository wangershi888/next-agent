# LangGraph Demo · 红蓝队辩论赛

这个 demo 把 LangGraph 用到「**双 agent 状态机**」的场景：红蓝双方各自维护独立的论点链，
**每一轮必须先反驳对方再立论**，judge 节点逐轮打分，条件边决定是继续辩还是出最终判决。
和单纯的反思 / 重写循环最大的不同：因为两个 agent 在「咬」对方上一轮的具体论点，
每一轮的内容会**真正发散**，而不是反复擦边重写一稿。

## 图结构

```
   START ─▶ red_argue ─▶ blue_argue ─▶ judge ──▶ decide
              ▲                                    │
              │ continue (round < maxRounds)       │
              └────────────────────────────────────┤
                                                   │
                                            final_verdict ──▶ END
```

- `red_argue` / `blue_argue` —— 各自读对方历史发言，先 rebuttal 再给 3 个新 points
- `judge` —— 给本轮红蓝双方分别 1-10 分 + 一句判词
- `decide` —— **条件边**：未到终轮回到 `red_argue`，否则进 `final_verdict`
- `final_verdict` —— 总分判胜负 + 总结陈词（节点名带 `final_` 是为了避免与 state 字段 `verdict` 撞名，LangGraph 硬约束）

## 关键代码（精简版）

```ts
const DebateState = Annotation.Root({
  topic: Annotation<string>(),
  redStance: Annotation<string>(),
  blueStance: Annotation<string>(),
  maxRounds: Annotation<number>({ reducer: (_, b) => b, default: () => 3 }),
  round: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  redTurns: Annotation<DebateTurn[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  blueTurns: Annotation<DebateTurn[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  judgments: Annotation<DebateJudgment[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  verdict: Annotation<DebateVerdict | null>({ reducer: (_, b) => b, default: () => null }),
});

const graph = new StateGraph(DebateState)
  .addNode("red_argue", redArgueNode)
  .addNode("blue_argue", blueArgueNode)
  .addNode("judge", judgeNode)
  .addNode("final_verdict", verdictNode)
  .addEdge(START, "red_argue")
  .addEdge("red_argue", "blue_argue")
  .addEdge("blue_argue", "judge")
  .addConditionalEdges("judge", decideRoute, {
    red_argue: "red_argue",          // 未到终轮 → 回到红方
    final_verdict: "final_verdict",  // 已到终轮 → 总判决
  })
  .addEdge("final_verdict", END)
  .compile();
```

## 演示要点

- **多 reducer 的状态合并**：`redTurns` / `blueTurns` / `judgments` 都用 `[...a, ...b]` reducer，
  每个节点只 emit 自己新增的部分，整图自动累积。
- **真正的条件路由**：`decideRoute` 根据 `state.round` 选择「继续」还是「终判」。
- **流式可观测**：`graph.stream({...}, { streamMode: "updates" })` 把每个节点的增量推给前端，
  UI 实时把红蓝发言、判词、最终判决渲染成左右双栏 + 累计分数仪表板。

## 涉及文件

- [`graph.ts`](./graph.ts) —— StateGraph 定义
- `app/api/langgraph/route.ts` —— SSE 流式接口
- `components/LangGraphDemo.tsx` —— 前端 UI（双栏辩论时间线 + 判分卡 + 最终判决）
