/**
 * LangChain demo —— 用最经典的 LCEL 管道展示「Prompt | Model | Parser」。
 *
 * 突出特性：
 *   1. PromptTemplate：把变量插值进对话模板
 *   2. .pipe() 组合（LCEL）：链式拼装可运行单元
 *   3. withStructuredOutput：用 Zod 直接拿到强类型 JSON
 */
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatDeepSeek } from "@langchain/deepseek";
import { z } from "zod";

const MovieSchema = z.object({
  title: z.string().describe("电影中文名"),
  year: z.number().int().describe("上映年份"),
  genre: z.string().describe("主要类型，如 科幻/爱情"),
  description: z.string().describe("一句话剧情简介"),
  why_recommended: z.string().describe("为什么契合用户的心情或场景"),
});

const RecommendationSchema = z.object({
  movies: z.array(MovieSchema).length(3).describe("精选 3 部电影"),
  summary: z.string().describe("整体推荐理由的总结，一句话"),
});

export type MovieRecommendation = z.infer<typeof RecommendationSchema>;

const prompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "你是一位资深影评人，请根据用户描述的「心情/场景」推荐 3 部电影。" +
      "请确保推荐风格多样、避免冷门到无人听过。",
  ],
  ["human", "我此刻的心情/场景：{mood}\n\n请用结构化方式给我推荐。"],
]);

function buildModel() {
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
    temperature: 0.6,
    // DeepSeek V4 默认开启 thinking 模式，但 thinking 模式不支持 withStructuredOutput
    // 所要求的「强制 tool_choice」（即指定具体函数名），所以这里显式关闭。
    modelKwargs: { thinking: { type: "disabled" } },
  });
}

export function buildMovieChain() {
  const llm = buildModel().withStructuredOutput(RecommendationSchema, {
    name: "recommend_movies",
  });

  return prompt.pipe(llm);
}

export async function recommendMovies(mood: string) {
  const chain = buildMovieChain();
  return chain.invoke({ mood });
}
