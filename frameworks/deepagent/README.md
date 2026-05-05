# DeepAgent Demo · 自主决策版竞品调研代理

> 这个 demo 与上一版本最大的区别：**SYSTEM_PROMPT 里没有"第一步、第二步"的脚本**。
> agent 必须自己判断怎么做，并把每个决策外化到 `record_decision` 工具调用里。
> 我们要演示的是 DeepAgent **自主规划 / 自主路由 / 自主迭代 / 自我反思** 的能力，而不是堆砌流程。

## 自主决策 vs 脚本执行的差异

| 维度 | 脚本式（旧版）| 自主决策式（本版本）|
|---|---|---|
| 系统提示 | "第一步：调用 X；第二步：调用 Y…" 八条命令 | "**目标 / 资源 / 价值观 / 十字路口**"，**没有任何"步骤"** |
| 调用 sub-agent | 严格按编号 1→6 依次调用 | agent 看 user 输入后**自己决定**调谁 / 跳过谁 / 重调几次 |
| 迭代轮数 | 固定一次 fact-check | 0–3 轮可变。fact-checker 给严重等级，agent 自己决定 |
| 决策可见性 | 不可见（脚本里写死了） | **每个分叉点必须调 `record_decision`**，UI 实时显示 |
| 错误恢复 | 全部数据当成 ground truth | high 严重等级时**重调指定 sub-agent**，让数据源头修正 |

## 自主决策的 4 个核心机制

### ① 开放式 SYSTEM_PROMPT（最关键）

```
# 你的身份
你是一名独立竞品调研顾问。给你一个调研目标，你自主完成一份高质量调研报告。

# 价值观（按优先级）
1. 事实优先 / 2. 批判思维 / 3. 结果导向 / 4. 诚实标注不确定性

# 你的资源
- 6 个专家 sub-agent（你可以调用 / 跳过 / 重调）
- 3 个自定义工具 / 文件系统 / 规划工具

# 你必须自主判断的十字路口
1. 调研深度（宽泛 vs 聚焦）
2. 数据置信度（要不要再查一次？）
3. 是否跳过 sub-agent
4. fact-check 后路径（low/medium/high 三种处理）
5. 何时停止迭代（最多 3 轮）
```

不再有"第一步先 X、第二步再 Y"——agent 真正在做决策，而不是背脚本。

### ② `record_decision` 自定义工具

每个十字路口必须先调用这个工具，把决策外化：

```ts
record_decision({
  situation: "fact-checker 给出 high 严重度，指出 financial-snapshot 数字与源不一致",
  options: ["直接修订 draft", "重调 financial-analyst", "降低断言后发版"],
  choice: "重调 financial-analyst",
  reason: "high 等级是数据源错误，自己改 draft 治标不治本",
  confidence: "high",
})
```

这让外部观察者（你 / 演讲听众）能**实时看到 agent 的判断链**，区分 "agent 在思考" 和 "agent 在按脚本走"。
UI 里专门有一个橙色的「决策时刻」面板把这些事件按时间轴展开。

### ③ fact-checker 主导的质量驱动循环

fact-checker 的输出强制包含三块：

```
## 严重等级
<high | medium | low | none>

## 建议主 agent 下一步行动
<已达标可发版 | 自行修订 | 重调 <子 agent 名>>

## 问题清单（按优先级）
- [严重度] 问题 → 修复建议
```

主 agent 看到 `severity=high` + `重调 financial-analyst` 时：
- 不是按脚本"再走一遍 fact-check"，
- 而是真的**重新调用 financial-analyst**，让源头数据修正，再走一轮。

UI 在 sub-agent 卡片上用 `×2` `×3` Badge 直接显示哪个 sub-agent 被重调过。

### ④ 动态 TODO

```
开局先 write_todos 列一份初步计划（3-6 条，不需要列全），
随后执行过程中按需追加。
不要一次性把所有未来步骤都列出来——这会让你显得像在背脚本。
```

观察 TODO 增长曲线就能看出 agent 是否真的在边做边规划。

## 你能在 UI 上看到的"自主性证据"

| UI 信号 | 含义 |
|---|---|
| 决策时刻面板有多张橙色卡 | agent 在思考，不是按脚本 |
| 某个 sub-agent 卡片显示 `×2` 或 `×3` Badge | agent 决定重调，进行了真正的迭代 |
| 某个 sub-agent 始终是 "未调用 (可能被跳过)" | agent 根据 user 输入主动跳过 |
| 顶部 `fact-check 轮数 × N` Tag (N>1) | 质量驱动循环真的跑了 |
| TODO 列表在执行过程中长度变化 | 动态规划而非一次性列全 |

## 6 个 Sub Agent 的 prompt 也是开放式

每个 sub-agent 的 prompt 现在长这样：

```
你是市场分析师，风格务实。**目标**：写 market-analysis.md...

**可用工具**：knowledge_lookup / compute_metric / read_file / write_file / record_decision

**你需要自己判断**：
- 这次研究的产品所在市场，是先看大盘 (TAM) 还是直接看可达市场 (SAM)？
- compute_metric 要算 1 次还是多次？算什么口径最关键？
- 竞争格局是泛泛列玩家就行，还是需要分层？

**自主性要求**：调用工具的次数 / 顺序由你自己判断；分叉点务必先 record_decision。
```

每个 sub-agent 也是真正在判断，而不是按列表执行。

## 关键代码

```ts
import { createDeepAgent } from "deepagents";

export function buildResearchAgent() {
  return createDeepAgent({
    model: buildModel(),
    systemPrompt: SYSTEM_PROMPT,                          // 开放式 / 目标导向
    tools: [knowledgeLookupTool, computeMetricTool, recordDecisionTool],
    subagents: SUBAGENTS,                                 // 6 个开放式 sub-agent
  });
}
```

## 演讲口径建议

1. **第一帧**：打开 demo，输入产品名，强调"我没告诉它要做哪几步"。
2. **运行时**：指着「决策时刻」面板，"这是 agent 自己在思考，不是脚本"。
3. **看到 `×2` Badge**：解释 fact-checker 给了 high → 主 agent 决定重调 → 这是质量驱动循环。
4. **看到 `跳过`**：解释 agent 看了 focus 字段后判断不需要某个 sub-agent。
5. **结尾**：与"普通 ReAct"或"LangGraph 固定图"对比——DeepAgent 把"agent 该做什么"完全放手给模型自己决策。

## 涉及文件

- [`agent.ts`](./agent.ts) —— Mock KB + 3 自定义工具 + 6 SubAgent + 开放式 SYSTEM_PROMPT
- `app/api/deepagent/route.ts` —— SSE 流式接口
- `components/DeepAgentDemo.tsx` —— 6 agent 状态徽章 + 决策时刻面板 + 多文件 tabs + 活动流
