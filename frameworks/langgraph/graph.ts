/**
 * LangGraph demo —— "反思式写作图"。
 *
 * 突出特性：
 *   1. 用 StateGraph + Annotation 显式描述「状态机」。
 *   2. 含条件边（critique → generate 形成循环），体现非线性控制流。
 *   3. 每个节点都是纯函数：(state) => Partial<state>，便于流式 / 调试。
 *
 * 流程：
 *
 *      ┌────────┐    ┌─────────┐    ┌─────────┐
 *  ──▶ │generate│ ─▶ │ critique│ ─▶ │ decide  │ ──▶ END
 *      └───▲────┘    └─────────┘    └────┬────┘
 *          │                             │ 不及格 / 还有预算
 *          └─────────────────────────────┘
 */
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { z } from "zod";

export type Critique = {
  score: number;
  feedback: string;
};

const ReflectionState = Annotation.Root({
  topic: Annotation<string>(),
  maxIterations: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 3,
  }),
  targetScore: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 8,
  }),
  iteration: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 0,
  }),
  drafts: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  critiques: Annotation<Critique[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

export type ReflectionStateType = typeof ReflectionState.State;

function buildModel(temperature = 0.5) {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error(
      "缺少 DEEPSEEK_API_KEY 环境变量，请在项目根目录创建 .env.local 并配置。",
    );
  }
  return new ChatDeepSeek({
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    apiKey: process.env.DEEPSEEK_API_KEY,
    configuration: process.env.DEEPSEEK_API_BASE
      ? { baseURL: process.env.DEEPSEEK_API_BASE }
      : undefined,
    temperature,
    // critique 节点要用 withStructuredOutput（强制 tool_choice），thinking 模式不兼容；
    // 为了 generate / critique 两个节点都用同一份配置，整图统一关闭 thinking。
    modelKwargs: { thinking: { type: "disabled" } },
  });
}

const generatePrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "你是一位风格鲜明的科普作家，请用 200-300 字写一段关于 {topic} 的短文。" +
      "如果收到「修改建议」，必须严格按照建议改写，不要重复同样的问题。",
  ],
  [
    "human",
    "主题：{topic}\n\n" +
      "上一稿：\n{previousDraft}\n\n" +
      "上一次的修改建议：\n{lastFeedback}\n\n" +
      "请输出新一稿（只输出正文，不要解释）。",
  ],
]);

const critiquePrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "你是一位严格的编辑。请给下面的短文打 1-10 分（10 分最好），" +
      "并用 1-2 句话指出最关键的一个改进方向。语气要直接、可执行。",
  ],
  ["human", "主题：{topic}\n\n短文：\n{draft}"],
]);

const CritiqueSchema = z.object({
  score: z.number().int().min(1).max(10).describe("综合评分 1-10"),
  feedback: z.string().describe("最关键的一条改进建议，1-2 句话"),
});

async function generateNode(state: ReflectionStateType) {
  const previousDraft =
    state.drafts.length > 0
      ? state.drafts[state.drafts.length - 1]
      : "（还没有草稿，请直接写第一稿）";
  const lastFeedback =
    state.critiques.length > 0
      ? state.critiques[state.critiques.length - 1].feedback
      : "（首次写作，无修改建议）";

  const llm = buildModel(0.7);
  const chain = generatePrompt.pipe(llm);
  const resp = await chain.invoke({
    topic: state.topic,
    previousDraft,
    lastFeedback,
  });
  const text =
    typeof resp.content === "string"
      ? resp.content
      : JSON.stringify(resp.content);
  return {
    drafts: [text],
    iteration: state.iteration + 1,
  };
}

async function critiqueNode(state: ReflectionStateType) {
  const draft = state.drafts[state.drafts.length - 1];
  const llm = buildModel(0.2).withStructuredOutput(CritiqueSchema, {
    name: "critique_draft",
  });
  const chain = critiquePrompt.pipe(llm);
  const result = await chain.invoke({ topic: state.topic, draft });
  return { critiques: [result] };
}

function decideRoute(state: ReflectionStateType): "generate" | typeof END {
  const last = state.critiques[state.critiques.length - 1];
  if (!last) return "generate";
  if (last.score >= state.targetScore) return END;
  if (state.iteration >= state.maxIterations) return END;
  return "generate";
}

export function buildReflectionGraph() {
  return new StateGraph(ReflectionState)
    .addNode("generate", generateNode)
    .addNode("critique", critiqueNode)
    .addEdge(START, "generate")
    .addEdge("generate", "critique")
    .addConditionalEdges("critique", decideRoute, {
      generate: "generate",
      [END]: END,
    })
    .compile();
}
