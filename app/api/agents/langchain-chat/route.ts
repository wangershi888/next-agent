import { createLangChainChatAgent } from "@/frameworks/langchain/agents/langchain-chat-agent";
import type { LangChainChatRequestBody } from "@/lib/types/chat";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 约束助手对用户可见的正文为中文；不要求改写代码、路径或系统/工具原始报错文本 */
const ASSISTANT_REPLY_ZH_SYSTEM = {
  role: "system" as const,
  content:
    "请使用简体中文撰写对用户可见的回复。代码片段、标识符、文件路径、URL、以及工具输出或系统报错中的原文可保留原样，无需强行翻译成中文。",
};

function extractTextFromToken(token: unknown): string {
  if (token == null) return "";
  if (typeof token === "string") return token;

  if (typeof token === "object") {
    const o = token as {
      content?: string;
      contentBlocks?: Array<{ type?: string; text?: string }>;
    };
    if (typeof o.content === "string" && o.content) return o.content;
    if (Array.isArray(o.contentBlocks)) {
      const parts = o.contentBlocks
        .filter((b) => b?.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string);
      if (parts.length) return parts.join("");
    }
  }

  return "";
}

function summarizeToolActivity(updatePayload: unknown): string | null {
  if (!updatePayload || typeof updatePayload !== "object") return null;
  const messages = (updatePayload as { messages?: unknown[] }).messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const last = messages[messages.length - 1] as Record<string, unknown> | undefined;
  if (!last) return null;

  const kwargs = (last.kwargs ?? last) as Record<string, unknown>;
  const toolCalls = kwargs.tool_calls as Array<{ name?: string }> | undefined;
  if (toolCalls?.length) {
    const names = toolCalls.map((t) => t.name).filter(Boolean);
    if (names.length) return names.join(", ");
  }

  const name = kwargs.name as string | undefined;
  if (name) return name;

  return null;
}

export async function POST(req: Request) {
  let body: LangChainChatRequestBody;
  try {
    body = (await req.json()) as LangChainChatRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messages, enableWebSearch } = body;
  if (!messages?.length) {
    return Response.json({ error: "messages 不能为空" }, { status: 400 });
  }

  try {
    const { agent, dispose } = await createLangChainChatAgent({
      enableWebSearch: Boolean(enableWebSearch),
    });
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };

        try {
          const messagesWithZhPrompt = [ASSISTANT_REPLY_ZH_SYSTEM, ...messages];

          const iterable = await agent.stream(
            { messages: messagesWithZhPrompt },
            { streamMode: ["messages", "updates"] as const },
          );

          for await (const item of iterable) {
            if (!Array.isArray(item) || item.length !== 2) continue;
            const [mode, chunk] = item as [string, unknown];

            if (mode === "messages") {
              if (!Array.isArray(chunk) || chunk.length < 2) continue;
              const [token] = chunk as [unknown, { langgraph_node?: string }];
              const text = extractTextFromToken(token);
              if (text) send({ type: "token", text });
            } else if (mode === "updates") {
              const record =
                chunk && typeof chunk === "object"
                  ? (chunk as Record<string, unknown>)
                  : null;
              if (!record) continue;
              const step = Object.keys(record)[0];
              const payload = step ? record[step] : undefined;
              const hint = summarizeToolActivity(payload);
              if (hint) send({ type: "tool", step, hint });
            }
          }

          send({ type: "done" });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          send({ type: "error", message });
        } finally {
          await dispose();
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
