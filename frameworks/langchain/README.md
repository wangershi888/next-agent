# LangChain Demo · 极简串行 LCEL 流水线

这个 demo 展示 LCEL 真正鼓励的写法：**每个 Runnable 只做一件极简的事**，
靠 `.pipe()` 串成一条很长的链。整条流水线**完全串行**——上一道题答完 + 评完
才会出下一道题，所以候选人每次作答都能看到完整的上下文，保持人设一致。

```
profile  ─▶  angles(N)  ─▶ ┌──Q1 ─▶ A1 ─▶ S1──┐
(1句画像)    (N 角度)       │                  │
                            ├──Q2 ─▶ A2 ─▶ S2──┤ ─▶ decision
                            │                  │     (hire/no_hire
                            └──Qn ─▶ An ─▶ Sn──┘      + 1 句理由)
                            （N 轮串行；
                            每轮 Q→A→S 三个 LLM 调用）
```

题量 N 由前端传入（1-5），总 LLM 调用数 = `2 + 3 × N + 1`。

## 关键代码（精简版）

```ts
// 6 类小 Runnable，每个 Schema 只 1-2 个字段
export const profileChain  = profilePrompt.pipe(...withStructuredOutput(ProfileSchema));
export function buildAnglesChain(count: number) {
  // 动态 length 的 schema，前端传几就生几个角度
  const schema = z.object({ angles: z.array(z.string().max(20)).length(count) });
  return anglesPrompt.pipe(...withStructuredOutput(schema));
}
export function buildQuestionChain() { ... } // 出题（带 previousQuestions 上下文）
export function buildAnswerChain()  { ... } // 候选人答题（带 history 上下文）
export function buildScoreChain()   { ... } // 评分
export const decisionChain = decisionPrompt.pipe(...withStructuredOutput(DecisionSchema));

// API 路由里把链串起来 —— 真正的「.pipe() 串成长链」
const { profile } = await profileChain.invoke({ position, resume });
const { angles  } = await buildAnglesChain(count).invoke({ position, profile, count });

const rounds = [];
for (const angle of angles) {
  const { question } = await questionChain.invoke({
    position, profile, angle,
    previousQuestions: formatPreviousQuestions(rounds.map(r => r.question)),
  });
  const { answer } = await answerChain.invoke({
    position, profile, question,
    history: formatHistory(rounds), // ← 关键：作答时能看到所有历史问答
  });
  const score = await scoreChain.invoke({ angle, question, answer });
  rounds.push({ angle, question, answer, ...score });
}

const decision = await decisionChain.invoke({ position, profile, scoreBreakdown });
```

## 演示要点

- **链路真长**：6 段 stage 数 = 2（profile/angles）+ 3×N（每题 Q/A/S）+ 1（decision），
  N=3 时总共 12 个可观察的 LLM 调用，每个都点亮 Steps 进度条上的一格。
- **节点真轻**：每个 LLM 输出 schema 只 1-2 字段、字符串都 `.max()` 限长，DeepSeek 失败概率低。
- **上下文真传递**：作答时把所有历史问答喂回去（`formatHistory`），出题时把已出过题目喂回去
  （`formatPreviousQuestions`）—— 这就是 LCEL「前段输出 = 后段输入」的核心。
- **题量可配**：前端 InputNumber 选 1-5 题，`buildAnglesChain(count)` 动态生成 schema。
- **withRetry 兜底**：每条链都加了 `.withRetry({ stopAfterAttempt: 3 })`，
  应对 DeepSeek 偶发的长中文 tool_call JSON 编码失败。

## 涉及文件

- [`chain.ts`](./chain.ts) —— 6 类独立 Runnable + history / scoreBreakdown 拼接工具
- `app/api/langchain/route.ts` —— for 循环串行 N 轮，SSE 推送 `stage` 与 `round` 事件
- `components/LangChainDemo.tsx` —— 横向 Steps 进度条 + 每轮卡片（竖向 Q→A→S 子步骤）+ 决策结果区
