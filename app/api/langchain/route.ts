import {
  buildAnglesChain,
  buildAnswerChain,
  buildQuestionChain,
  buildScoreChain,
  decisionChain,
  formatHistory,
  formatPreviousQuestions,
  formatScoreBreakdown,
  profileChain,
} from "@/frameworks/langchain/chain";

export const runtime = "nodejs";

type Body = {
  position?: string;
  resume?: string;
  /** 题目数量（即考察角度数量），范围 1-5，默认 3 */
  count?: number;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: "无效的 JSON 请求" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const position = (body.position ?? "").trim();
  const resume = (body.resume ?? "").trim();
  if (!position || !resume) {
    return new Response(
      JSON.stringify({ error: "position 与 resume 都不能为空" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  const count = Math.max(1, Math.min(5, body.count ?? 3));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };
      const stage = (
        name: string,
        status: "running" | "done",
        payload?: unknown,
      ) => send({ type: "stage", stage: name, status, payload });
      const round = (
        idx: number,
        sub: "question" | "answer" | "score",
        status: "running" | "done",
        payload?: unknown,
      ) => send({ type: "round", round: idx, sub, status, payload });

      try {
        send({ type: "start", position, resume, count });

        // ===== Stage 1: profile =====
        stage("profile", "running");
        const { profile } = await profileChain.invoke({ position, resume });
        stage("profile", "done", { profile });

        // ===== Stage 2: angles（动态 N 个） =====
        stage("angles", "running");
        const { angles } = await buildAnglesChain(count).invoke({
          position,
          profile,
          count,
        });
        stage("angles", "done", { angles });

        // ===== Stage 3..N+2: 串行 N 轮（每轮 Q → A → S）=====
        const questionChain = buildQuestionChain();
        const answerChain = buildAnswerChain();
        const scoreChain = buildScoreChain();

        const rounds: {
          angle: string;
          question: string;
          answer: string;
          score: number;
          comment: string;
        }[] = [];

        for (let i = 0; i < angles.length; i++) {
          const angle = angles[i];
          const idx = i + 1;

          // —— 出题（看到之前所有题目，避免重复）
          round(idx, "question", "running");
          const { question } = await questionChain.invoke({
            position,
            profile,
            angle,
            previousQuestions: formatPreviousQuestions(rounds.map((r) => r.question)),
          });
          round(idx, "question", "done", { angle, question });

          // —— 答题（看到之前所有 Q&A 历史，保持人设一致）
          round(idx, "answer", "running");
          const { answer } = await answerChain.invoke({
            position,
            profile,
            history: formatHistory(rounds.map((r) => ({ question: r.question, answer: r.answer }))),
            question,
          });
          round(idx, "answer", "done", { answer });

          // —— 评分
          round(idx, "score", "running");
          const { score, comment } = await scoreChain.invoke({
            angle,
            question,
            answer,
          });
          round(idx, "score", "done", { score, comment });

          rounds.push({ angle, question, answer, score, comment });
        }

        // ===== Stage final: 综合决策 =====
        stage("decision", "running");
        const decision = await decisionChain.invoke({
          position,
          profile,
          scoreBreakdown: formatScoreBreakdown(rounds),
        });
        stage("decision", "done", { decision });

        send({ type: "end" });
      } catch (err) {
        send({
          type: "error",
          error: err instanceof Error ? err.message : "unknown error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
