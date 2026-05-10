import { ChatOpenAI } from "@langchain/openai";

/**
 * 通义千问 — 阿里云 DashScope OpenAI 兼容接口。
 * 密钥：`DASHSCOPE_API_KEY`（见 `.env.example`）
 */
export function createQwenChatModel() {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error("缺少环境变量 DASHSCOPE_API_KEY");
  }

  const model = process.env.QWEN_MODEL ?? "qwen-plus";

  return new ChatOpenAI({
    model,
    temperature: 0.6,
    streaming: true,
    apiKey,
    configuration: {
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
  });
}
