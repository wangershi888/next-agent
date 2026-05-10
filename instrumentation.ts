/** Next.js：服务端启动时可选打印 LangSmith 状态（仅 development） */

export async function register() {
  if (process.env.NODE_ENV !== "development") return;

  const tracingOn =
    process.env.LANGCHAIN_TRACING_V2 === "true" ||
    process.env.LANGSMITH_TRACING === "true";

  const apiKey = (
    process.env.LANGCHAIN_API_KEY ??
    process.env.LANGSMITH_API_KEY ??
    ""
  ).trim();

  if (tracingOn && apiKey.length > 0) {
    const project = process.env.LANGCHAIN_PROJECT ?? "default";
    console.info(`[LangSmith] tracing enabled · LANGCHAIN_PROJECT=${project}`);
  }
}
