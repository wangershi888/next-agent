import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  Annotation,
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import { createQwenChatModel } from "@/frameworks/langchain/model/chat-models";
import type { ArgumentAssistantHumanFinalResume } from "@/lib/types/chat";

/** 共享状态：演示 Annotation / 多节点读写 LastValue */
export const ArgumentAssistantState = Annotation.Root({
  topic: Annotation<string>(),
  passThreshold: Annotation<number>(),
  maxIterations: Annotation<number>(),
  revisionCount: Annotation<number>(),
  draft: Annotation<string>(),
  score: Annotation<number | null>(),
  scorerFeedback: Annotation<string>(),
  passed: Annotation<boolean>(),
  passAdvice: Annotation<string>(),
  aborted: Annotation<boolean>(),
});

export type ArgumentAssistantStateType = typeof ArgumentAssistantState.State;

function parseScorerJson(text: string): { score: number; feedback: string } {
  const block = text.match(/\{[\s\S]*\}/);
  if (!block) {
    return { score: 5, feedback: "模型未返回 JSON，请重试。" };
  }
  try {
    const raw = JSON.parse(block[0]) as { score?: unknown; feedback?: unknown };
    const score = Number(raw.score);
    const feedback =
      typeof raw.feedback === "string" && raw.feedback.trim()
        ? raw.feedback.trim()
        : "（无具体建议）";
    if (!Number.isFinite(score)) {
      return { score: 5, feedback };
    }
    return { score: Math.min(10, Math.max(1, score)), feedback };
  } catch {
    return { score: 5, feedback: "评分 JSON 解析失败。" };
  }
}

function routeAfterScorer(state: ArgumentAssistantStateType): string {
  const s = state.score;
  const threshold = state.passThreshold;
  if (s != null && s >= threshold) return "finalize_success";
  if (state.revisionCount >= state.maxIterations) return "human_final";
  return "writer";
}

export function buildArgumentAssistantGraph() {
  const model = createQwenChatModel({ streaming: false, temperature: 0.55 });
  const writerModel = createQwenChatModel({ streaming: false, temperature: 0.72 });

  const writer = async (state: ArgumentAssistantStateType) => {
    const prev = state.draft?.trim() ?? "";
    const fb = state.scorerFeedback?.trim() ?? "";
    const rev = state.revisionCount + 1;

    const system = new SystemMessage(`你是「论点编写助手」。输出极简中文论点稿（建议不超过 120 字）。
规则：
- 紧扣主题，给出可辩论的核心论点（1 条主线即可）。
- 若存在上一稿与评分反馈，必须实质性改写：更换论据角度或表述结构，禁止复述上一稿句子。
- 当前为第 ${rev} 稿；上一稿如下（可为空）：${prev ? `「${prev}」` : "（首稿）"}
- 评分反馈（可为空）：${fb ? fb : "（尚无）"}`);

    const user = new HumanMessage(`主题：${state.topic.trim()}`);

    const res = await writerModel.invoke([system, user]);
    const text =
      typeof res.content === "string"
        ? res.content
        : Array.isArray(res.content)
          ? res.content
              .map((b) => ("text" in b && typeof b.text === "string" ? b.text : ""))
              .join("")
          : String(res.content ?? "");

    const draft = text.trim().slice(0, 400);

    return {
      draft,
      revisionCount: rev,
    };
  };

  const scorer = async (state: ArgumentAssistantStateType) => {
    const system = new SystemMessage(`你是严格阅卷老师。根据论点稿质量打分（1-10，整数），并给出简短改进建议（不超过 80 字）。
务必只输出一行合法 JSON，格式：{"score": number, "feedback": "..."}，不要有其它文字。`);

    const user = new HumanMessage(
      `主题：${state.topic.trim()}\n论点稿：${state.draft.trim()}`,
    );

    const res = await model.invoke([system, user]);
    const raw =
      typeof res.content === "string"
        ? res.content
        : String(res.content ?? "");

    const { score, feedback } = parseScorerJson(raw);
    return {
      score,
      scorerFeedback: feedback,
    };
  };

  const finalizeSuccess = async (state: ArgumentAssistantStateType) => {
    const system = new SystemMessage(
      "用不超过 60 字中文给出「通过后的简短写作建议」（面向作者），不要重复论点正文。",
    );
    const user = new HumanMessage(
      `得分 ${state.score}/10。论点摘要：${state.draft.slice(0, 200)}`,
    );
    const res = await model.invoke([system, user]);
    const advice =
      typeof res.content === "string"
        ? res.content.trim()
        : String(res.content ?? "").trim();

    return {
      passed: true,
      passAdvice: advice || "已通过评分阈值。",
    };
  };

  const humanFinal = async (state: ArgumentAssistantStateType) => {
    const resume = interrupt<
      {
        kind: "human_final";
        draft: string;
        score: number | null;
        feedback: string;
        revisionCount: number;
        maxIterations: number;
        passThreshold: number;
      },
      ArgumentAssistantHumanFinalResume
    >({
      kind: "human_final",
      draft: state.draft,
      score: state.score,
      feedback: state.scorerFeedback,
      revisionCount: state.revisionCount,
      maxIterations: state.maxIterations,
      passThreshold: state.passThreshold,
    });

    if (resume.action === "force_pass") {
      return {
        passed: true,
        passAdvice:
          "已达最大改写次数，用户选择采纳当前稿件（未满足分数阈值）。后续可自行润色。",
      };
    }

    return { aborted: true };
  };

  const graph = new StateGraph(ArgumentAssistantState)
    .addNode("writer", writer)
    .addNode("scorer", scorer)
    .addNode("finalize_success", finalizeSuccess)
    .addNode("human_final", humanFinal)
    .addEdge(START, "writer")
    .addEdge("writer", "scorer")
    .addConditionalEdges("scorer", routeAfterScorer, {
      finalize_success: "finalize_success",
      human_final: "human_final",
      writer: "writer",
    })
    .addEdge("finalize_success", END)
    .addEdge("human_final", END);

  const checkpointer = new MemorySaver();
  const compiled = graph.compile({ checkpointer });

  return { compiled, checkpointer };
}

/** 单例：同一 MemorySaver 才能用 thread_id 做中断恢复 */
let bundle: ReturnType<typeof buildArgumentAssistantGraph> | null = null;

export function getArgumentAssistantGraph() {
  if (!bundle) bundle = buildArgumentAssistantGraph();
  return bundle;
}

/** 供路由层包装 resume */
export function resumeCommand(payload: ArgumentAssistantHumanFinalResume) {
  return new Command({ resume: payload });
}
