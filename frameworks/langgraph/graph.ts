/**
 * LangGraph demo —— "红蓝队辩论赛"。
 *
 * 突出特性（升级版）：
 *   1. 真正的双 agent 状态机：红队 / 蓝队 各自维护独立的论点链路。
 *   2. 显式条件边：judge 节点根据 round 决定是回合继续 (→ red_argue)
 *      还是终局裁决 (→ verdict)。
 *   3. 多轮"咬合"：每一轮 red_argue 必须先反驳 blue 上一轮的论点，
 *      blue_argue 也一样。两条状态线在反驳中真正发散，避免「每轮内容雷同」。
 *
 * 流程：
 *
 *   START ─▶ red_argue ─▶ blue_argue ─▶ judge ──▶ decide
 *               ▲                                    │
 *               │ continue (round < maxRounds)       │
 *               └────────────────────────────────────┤
 *                                                    │
 *                                              final_verdict ──▶ END
 *
 * 注意：节点名不能与 state 字段同名（LangGraph 硬约束），所以这里叫 final_verdict，
 *       它写入的字段才叫 verdict。
 */
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { z } from "zod";

// ============== 类型 / Schema ==============

export type DebateSide = "red" | "blue";

export type DebateTurn = {
  side: DebateSide;
  round: number;
  rebuttal: string;
  points: string[];
  emotional_tone: "calm" | "fierce" | "sarcastic" | "passionate";
};

export type DebateJudgment = {
  round: number;
  redScore: number;
  blueScore: number;
  comment: string;
};

export type DebateVerdict = {
  winner: "red" | "blue" | "draw";
  finalRedScore: number;
  finalBlueScore: number;
  commentary: string;
};

const TurnSchema = z.object({
  rebuttal: z
    .string()
    .describe(
      "对对方上一轮论点的针对性反驳，2-4 句话；如果对方还没发言（首轮），写「（首轮立论，无可反驳）」",
    ),
  points: z
    .array(z.string())
    .length(3)
    .describe("自己这一轮的 3 个核心论点，每条 1-2 句，要新颖、有冲击力"),
  emotional_tone: z
    .enum(["calm", "fierce", "sarcastic", "passionate"])
    .describe("本轮发言的情绪风格"),
});

const JudgmentSchema = z.object({
  redScore: z.number().int().min(1).max(10).describe("红方本轮表现 1-10"),
  blueScore: z.number().int().min(1).max(10).describe("蓝方本轮表现 1-10"),
  comment: z
    .string()
    .max(120)
    .describe(
      "本轮判词，最多 2 句话；点评双方亮点 / 漏洞要直接，禁止和稀泥；不要使用任何引号或换行符",
    ),
});

const VerdictSchema = z.object({
  winner: z.enum(["red", "blue", "draw"]).describe("最终胜方"),
  commentary: z
    .string()
    .describe("总结陈词，3-5 句话，要点出胜负关键节点"),
});

// ============== State ==============

const DebateState = Annotation.Root({
  topic: Annotation<string>(),
  redStance: Annotation<string>(),
  blueStance: Annotation<string>(),
  maxRounds: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 3,
  }),
  round: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 0,
  }),
  redTurns: Annotation<DebateTurn[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  blueTurns: Annotation<DebateTurn[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  judgments: Annotation<DebateJudgment[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  verdict: Annotation<DebateVerdict | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
});

export type DebateStateType = typeof DebateState.State;

// ============== Model ==============

function buildModel(temperature = 0.8) {
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
    // V4 thinking 模式不支持 withStructuredOutput 的强制 tool_choice
    modelKwargs: { thinking: { type: "disabled" } },
  });
}

// ============== Prompt 模板 ==============

function buildSidePrompt(side: DebateSide) {
  const ownColor = side === "red" ? "红方（正方）" : "蓝方（反方）";
  const oppColor = side === "red" ? "蓝方（反方）" : "红方（正方）";
  return ChatPromptTemplate.fromMessages([
    [
      "system",
      `你是一位顶尖辩手，现在代表「${ownColor}」。\n` +
        `你的核心立场：{ownStance}\n` +
        `对方（${oppColor}）的核心立场：{oppStance}\n\n` +
        `本场辩论规则：\n` +
        `1. 必须先「针对性反驳」对方上一轮的具体论点，不能泛泛而谈。\n` +
        `2. 然后给出本轮 3 个**完全不同于上一轮自己说过的**新论点。\n` +
        `3. 论点要可反驳、有针锋相对的火药味，避免无伤大雅的泛论。\n` +
        `4. 越往后回合越「咬」对方的薄弱处，不要重复自己说过的话。\n` +
        `5. 严禁回到原始立场重复，必须推进辩论的深度。`,
    ],
    [
      "human",
      `辩题：{topic}\n` +
        `当前是第 {round} 轮（共 {maxRounds} 轮）。\n\n` +
        `【自己历史发言】\n{ownHistory}\n\n` +
        `【对方历史发言（重点反驳「最近一轮」）】\n{oppHistory}\n\n` +
        `请输出：rebuttal（针对对方最近一轮的反驳） + 3 个 points + emotional_tone。`,
    ],
  ]);
}

const judgePrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "你是一位以严苛著称的辩论裁判。每轮结束你都要给红蓝双方各一个 1-10 分，" +
      "并写一句一针见血的点评。要点出谁的反驳更命中要害、谁的论点更新颖；" +
      "不要给双方一样的分；尽量避免双方都给 7-8 这种和稀泥分布。\n\n" +
      "【输出格式硬性要求】\n" +
      "- comment 字段最多 60 个汉字，必须为单行\n" +
      "- comment 字段内**不允许**出现任何中英文引号、换行、JSON 转义符\n" +
      "- 整体响应必须是合法 JSON，字符串值都要正确加引号",
  ],
  [
    "human",
    "辩题：{topic}\n第 {round} 轮记录：\n\n" +
      "【红方】\n反驳：{redRebuttal}\n论点：{redPoints}\n语气：{redTone}\n\n" +
      "【蓝方】\n反驳：{blueRebuttal}\n论点：{bluePoints}\n语气：{blueTone}",
  ],
]);

const verdictPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "你是辩论赛终局评委。请基于完整的多轮历史与历轮判分，给出最终胜负。" +
      "不允许默认平局，除非两边累计分数差距 ≤ 1。" +
      "总结陈词必须点出胜负的关键回合 / 关键论点。",
  ],
  [
    "human",
    "辩题：{topic}\n红方立场：{redStance}\n蓝方立场：{blueStance}\n\n" +
      "完整辩论记录：\n{transcript}\n\n" +
      "历轮判分：\n{judgments}\n\n请输出最终判决。",
  ],
]);

// ============== 节点 ==============

function formatHistory(turns: DebateTurn[]): string {
  if (turns.length === 0) return "（暂无历史发言）";
  return turns
    .map(
      (t) =>
        `第 ${t.round} 轮 [${t.emotional_tone}]\n` +
        `  反驳：${t.rebuttal}\n` +
        `  论点：\n${t.points.map((p, i) => `    ${i + 1}) ${p}`).join("\n")}`,
    )
    .join("\n\n");
}

function makeArgueNode(side: DebateSide) {
  const prompt = buildSidePrompt(side);
  return async (state: DebateStateType) => {
    const ownTurns = side === "red" ? state.redTurns : state.blueTurns;
    const oppTurns = side === "red" ? state.blueTurns : state.redTurns;
    const ownStance = side === "red" ? state.redStance : state.blueStance;
    const oppStance = side === "red" ? state.blueStance : state.redStance;

    // round 增加只在 red_argue 那一步做（每两次发言算一轮）
    const nextRound = side === "red" ? state.round + 1 : state.round;

    const llm = buildModel(0.85).withStructuredOutput(TurnSchema, {
      name: `${side}_turn`,
    });
    // DeepSeek 在生成长中文 tool_call arguments 时偶发会漏引号 → 加重试兜底
    const chain = prompt.pipe(llm).withRetry({ stopAfterAttempt: 3 });
    const out = await chain.invoke({
      topic: state.topic,
      ownStance,
      oppStance,
      round: nextRound,
      maxRounds: state.maxRounds,
      ownHistory: formatHistory(ownTurns),
      oppHistory: formatHistory(oppTurns),
    });

    const turn: DebateTurn = {
      side,
      round: nextRound,
      rebuttal: out.rebuttal,
      points: out.points,
      emotional_tone: out.emotional_tone,
    };

    return side === "red"
      ? { redTurns: [turn], round: nextRound }
      : { blueTurns: [turn] };
  };
}

const redArgueNode = makeArgueNode("red");
const blueArgueNode = makeArgueNode("blue");

async function judgeNode(state: DebateStateType) {
  const lastRed = state.redTurns[state.redTurns.length - 1];
  const lastBlue = state.blueTurns[state.blueTurns.length - 1];
  if (!lastRed || !lastBlue) return {};

  const llm = buildModel(0.2).withStructuredOutput(JudgmentSchema, {
    name: "round_judgment",
  });
  const chain = judgePrompt.pipe(llm).withRetry({ stopAfterAttempt: 3 });
  const j = await chain.invoke({
    topic: state.topic,
    round: state.round,
    redRebuttal: lastRed.rebuttal,
    redPoints: lastRed.points.join(" / "),
    redTone: lastRed.emotional_tone,
    blueRebuttal: lastBlue.rebuttal,
    bluePoints: lastBlue.points.join(" / "),
    blueTone: lastBlue.emotional_tone,
  });

  const judgment: DebateJudgment = {
    round: state.round,
    redScore: j.redScore,
    blueScore: j.blueScore,
    comment: j.comment,
  };
  return { judgments: [judgment] };
}

async function verdictNode(state: DebateStateType) {
  const transcript = [
    "=== 红方完整发言 ===",
    formatHistory(state.redTurns),
    "",
    "=== 蓝方完整发言 ===",
    formatHistory(state.blueTurns),
  ].join("\n");

  const judgmentsText = state.judgments
    .map(
      (j) =>
        `第 ${j.round} 轮 · 红 ${j.redScore} vs 蓝 ${j.blueScore}  ——  ${j.comment}`,
    )
    .join("\n");

  const llm = buildModel(0.2).withStructuredOutput(VerdictSchema, {
    name: "final_verdict",
  });
  const chain = verdictPrompt.pipe(llm).withRetry({ stopAfterAttempt: 3 });
  const v = await chain.invoke({
    topic: state.topic,
    redStance: state.redStance,
    blueStance: state.blueStance,
    transcript,
    judgments: judgmentsText,
  });

  const finalRedScore = state.judgments.reduce((s, j) => s + j.redScore, 0);
  const finalBlueScore = state.judgments.reduce((s, j) => s + j.blueScore, 0);

  const verdict: DebateVerdict = {
    winner: v.winner,
    finalRedScore,
    finalBlueScore,
    commentary: v.commentary,
  };
  return { verdict };
}

function decideRoute(
  state: DebateStateType,
): "red_argue" | "final_verdict" {
  if (state.round >= state.maxRounds) return "final_verdict";
  return "red_argue";
}

export function buildDebateGraph() {
  return new StateGraph(DebateState)
    .addNode("red_argue", redArgueNode)
    .addNode("blue_argue", blueArgueNode)
    .addNode("judge", judgeNode)
    .addNode("final_verdict", verdictNode)
    .addEdge(START, "red_argue")
    .addEdge("red_argue", "blue_argue")
    .addEdge("blue_argue", "judge")
    .addConditionalEdges("judge", decideRoute, {
      red_argue: "red_argue",
      final_verdict: "final_verdict",
    })
    .addEdge("final_verdict", END)
    .compile();
}
