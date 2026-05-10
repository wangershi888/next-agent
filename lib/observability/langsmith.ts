import { Client } from "langsmith";

/**
 * LangSmith 与 LangChain / LangGraph 的集成方式为 **环境变量自动启用 trace**。
 *
 * @see https://docs.langchain.com/langsmith/trace-with-langchain
 *
 * 必备（启用上报）：
 * - `LANGCHAIN_TRACING_V2=true`（或部分版本支持 `LANGSMITH_TRACING=true`）
 * - `LANGCHAIN_API_KEY`（或 `LANGSMITH_API_KEY`，二选一）
 *
 * 常用：
 * - `LANGCHAIN_PROJECT` —— LangSmith 项目名称（默认 `default`）
 * - `LANGCHAIN_ENDPOINT` —— 自建或区域端点时可覆盖（默认美国区 REST）
 */

export function isLangSmithTracingConfigured(): boolean {
  const tracingOn =
    process.env.LANGCHAIN_TRACING_V2 === "true" ||
    process.env.LANGSMITH_TRACING === "true";

  const apiKey = (
    process.env.LANGCHAIN_API_KEY ??
    process.env.LANGSMITH_API_KEY ??
    ""
  ).trim();

  return tracingOn && apiKey.length > 0;
}

/**
 * Next.js Serverless / 流式路由结束前调用，尽量把批量 trace 发完（避免进程提前冻结导致丢 span）。
 */
export async function flushLangSmithPendingTraces(): Promise<void> {
  if (!isLangSmithTracingConfigured()) return;
  try {
    const client = new Client();
    await client.awaitPendingTraceBatches();
  } catch {
    // 观测链路不应影响业务响应
  }
}
