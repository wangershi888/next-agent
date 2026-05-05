/**
 * LangChain demo —— "极简串行 LCEL 流水线"。
 *
 * 设计原则：每个 Runnable 只做一件极简的事，靠 .pipe() 串成一条很长的链。
 *           整条流水线**完全串行**：上一道题答完才出下一道题，最后才决策。
 *
 * 流水线（动态 N，N 由前端传入，默认 3）：
 *
 *   profile ─▶ angles(N) ─▶ ┌──Q1 ─▶ A1 ─▶ S1──┐
 *                           │                  │
 *                           ├──Q2 ─▶ A2 ─▶ S2──┤ ─▶ decision
 *                           │                  │     (hire/no_hire
 *                           └──Qn ─▶ An ─▶ Sn──┘      + 1 句理由)
 *                              （N 轮串行，
 *                               每轮先出题、再答题、再评分）
 */
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatDeepSeek } from "@langchain/deepseek";
import { z } from "zod";

// ============== Schema：每个都极简 ==============

const ProfileSchema = z.object({
  profile: z.string().max(80).describe("候选人 1 句话画像，最多 40 字"),
});

const AngleStringSchema = z.string().max(20);

/** 动态长度的 angles schema —— 由前端传入题量，避免硬编码。 */
function buildAnglesSchema(count: number) {
  return z.object({
    angles: z
      .array(AngleStringSchema)
      .length(count)
      .describe(`${count} 个简短的考察角度，每个最多 10 字`),
  });
}

const QuestionSchema = z.object({
  question: z.string().max(80).describe("一道面试题，最多 40 字"),
});

/** 单题作答（与原来的「一次回 3 题」不同，现在每轮只答一题） */
const SingleAnswerSchema = z.object({
  answer: z
    .string()
    .max(160)
    .describe("对当前面试题的回答，最多 80 字，要言之有物"),
});

const ScoreSchema = z.object({
  score: z.number().int().min(1).max(10).describe("打分 1-10"),
  comment: z
    .string()
    .max(80)
    .describe("一句点评，最多 40 字，禁止使用引号或换行"),
});

const DecisionSchema = z.object({
  hire_decision: z.enum(["hire", "no_hire"]).describe("最终录用决策"),
  reason: z
    .string()
    .max(100)
    .describe("决策原因，1 句话，最多 50 字，禁止使用引号或换行"),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type QuestionOut = z.infer<typeof QuestionSchema>;
export type SingleAnswer = z.infer<typeof SingleAnswerSchema>;
export type ScoreOut = z.infer<typeof ScoreSchema>;
export type Decision = z.infer<typeof DecisionSchema>;

// ============== 模型工厂 ==============

function buildModel(temperature: number) {
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
    modelKwargs: { thinking: { type: "disabled" } },
  });
}

// ============== Prompts ==============

const profilePrompt = ChatPromptTemplate.fromMessages([
  ["system", "用一句话（最多 40 字）总结候选人画像，要点出最显著的一两个标签。"],
  ["human", "岗位：{position}\n简历摘要：{resume}"],
]);

const anglesPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "基于「岗位」和「候选人画像」，给出 {count} 个简短的面试考察角度，每个最多 10 字。" +
      "{count} 个角度要互不重复、覆盖技术 + 软素质。",
  ],
  ["human", "岗位：{position}\n候选人画像：{profile}\n题量：{count}"],
]);

const questionPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "你是面试官。围绕「考察角度」出 1 道精炼面试题，最多 40 字，必须可口头作答。\n" +
      "**严禁与「已出过的题目」雷同或换皮重复**——必须切入一个之前没问过的具体方向。",
  ],
  [
    "human",
    "岗位：{position}\n候选人画像：{profile}\n本次考察角度：{angle}\n\n" +
      "已出过的题目：\n{previousQuestions}",
  ],
]);

const answerPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "你扮演候选人。请回答下面这道面试题，最多 80 字，要言之有物。\n" +
      "回答必须与「之前的问答记录」中表现出的人设保持一致；如果之前已经提到过的项目 / 数字，请保持口径一致，不要前后矛盾。",
  ],
  [
    "human",
    "岗位：{position}\n候选人画像：{profile}\n\n" +
      "之前的问答记录：\n{history}\n\n" +
      "本次问题：{question}",
  ],
]);

const scorePrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "你是评分员。给「答案」打 1-10 分，并写一句点评（最多 40 字）。" +
      "评分要严格，普通回答给 5-6 分。",
  ],
  ["human", "考察角度：{angle}\n题目：{question}\n答案：{answer}"],
]);

const decisionPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "你是 hiring manager。综合 N 道题的分数与点评，输出 hire 或 no_hire，加 1 句理由。" +
      "总分均值 ≥ 7 倾向 hire；总分均值 ≤ 5 倾向 no_hire；中间区间看综合表现。",
  ],
  [
    "human",
    "岗位：{position}\n候选人画像：{profile}\n" +
      "评分明细：\n{scoreBreakdown}",
  ],
]);

// ============== 6 类 Runnable ==============

const RETRY = { stopAfterAttempt: 3 } as const;

export const profileChain = profilePrompt
  .pipe(
    buildModel(0.3).withStructuredOutput(ProfileSchema, { name: "profile" }),
  )
  .withRetry(RETRY);

/** anglesChain 是动态 schema 的工厂（length 由 count 决定） */
export function buildAnglesChain(count: number) {
  const schema = buildAnglesSchema(count);
  return anglesPrompt
    .pipe(buildModel(0.6).withStructuredOutput(schema, { name: "angles" }))
    .withRetry(RETRY);
}

export function buildQuestionChain() {
  return questionPrompt
    .pipe(
      buildModel(0.7).withStructuredOutput(QuestionSchema, { name: "question" }),
    )
    .withRetry(RETRY);
}

export function buildAnswerChain() {
  return answerPrompt
    .pipe(
      buildModel(0.7).withStructuredOutput(SingleAnswerSchema, {
        name: "answer",
      }),
    )
    .withRetry(RETRY);
}

export function buildScoreChain() {
  return scorePrompt
    .pipe(buildModel(0.3).withStructuredOutput(ScoreSchema, { name: "score" }))
    .withRetry(RETRY);
}

export const decisionChain = decisionPrompt
  .pipe(
    buildModel(0.2).withStructuredOutput(DecisionSchema, { name: "decision" }),
  )
  .withRetry(RETRY);

// ============== 一些 prompt 拼接的小工具 ==============

export function formatHistory(
  rounds: { question: string; answer: string }[],
): string {
  if (rounds.length === 0) return "（首道题，无问答记录）";
  return rounds
    .map((r, i) => `Q${i + 1}: ${r.question}\nA${i + 1}: ${r.answer}`)
    .join("\n\n");
}

export function formatPreviousQuestions(questions: string[]): string {
  if (questions.length === 0) return "（首道题，没有已出题目）";
  return questions.map((q, i) => `${i + 1}) ${q}`).join("\n");
}

export function formatScoreBreakdown(
  rounds: {
    angle: string;
    question: string;
    answer: string;
    score: number;
    comment: string;
  }[],
): string {
  return rounds
    .map(
      (r, i) =>
        `${i + 1}) [${r.angle}] ${r.score}/10 — ${r.comment}\n   题：${r.question}\n   答：${r.answer}`,
    )
    .join("\n");
}
