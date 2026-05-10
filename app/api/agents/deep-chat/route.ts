import { createNextDeepChatAgent } from "@/frameworks/deepagents/deep-chat-agent";
import { buildBundledSkillFiles } from "@/frameworks/deepagents/bundled-skills";
import type { DeepChatRequestBody } from "@/lib/types/chat";
import { flushLangSmithPendingTraces } from "@/lib/observability/langsmith";

export const runtime = "nodejs";
export const maxDuration = 120;

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

function safeJsonSnippet(obj: unknown, max = 280): string {
  try {
    const s = JSON.stringify(obj);
    if (!s) return "";
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return "";
  }
}

function parseToolCallArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const o = JSON.parse(raw) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) {
        return o as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  return {};
}

/** 虚拟路径 /skills/<slug>/SKILL.md */
const SKILL_FILE_PATH = /^\/skills\/([^/]+)\/SKILL\.md$/i;

function extractSkillHitsFromMessages(
  messages: unknown[],
): Array<{ slug: string; path: string }> {
  const hits: Array<{ slug: string; path: string }> = [];
  for (const msg of messages) {
    const rec = msg as Record<string, unknown>;
    const kwargs = (rec.kwargs ?? rec) as Record<string, unknown>;
    const toolCalls = kwargs.tool_calls as
      | Array<{ name?: string; args?: unknown }>
      | undefined;
    if (!toolCalls?.length) continue;
    for (const tc of toolCalls) {
      if (tc.name !== "read_file") continue;
      const args = parseToolCallArgs(tc.args);
      const filePath = args.file_path ?? args.path;
      if (typeof filePath !== "string") continue;
      const norm = filePath.replace(/\\/g, "/");
      const m = norm.match(SKILL_FILE_PATH);
      if (m?.[1]) hits.push({ slug: m[1], path: norm });
    }
  }
  return hits;
}

function summarizeToolCallsFromMessages(messages: unknown[]): {
  names: string[];
  detail?: string;
} | null {
  if (!messages.length) return null;
  const last = messages[messages.length - 1] as Record<string, unknown> | undefined;
  if (!last) return null;

  const kwargs = (last.kwargs ?? last) as Record<string, unknown>;
  const toolCalls = kwargs.tool_calls as
    | Array<{ name?: string; args?: unknown; id?: string }>
    | undefined;
  if (toolCalls?.length) {
    const names = toolCalls.map((t) => t.name).filter(Boolean) as string[];
    const firstArgs = toolCalls[0]?.args;
    const detail = firstArgs != null ? safeJsonSnippet(firstArgs) : undefined;
    if (names.length) return { names, detail };
  }

  const name = kwargs.name as string | undefined;
  if (name === "tool" || last.id != null) {
    const toolName = (kwargs.name as string) || (last.name as string);
    if (toolName) return { names: [toolName] };
  }

  return null;
}

function extractTodosFromValues(values: unknown): Array<{
  content: string;
  status: string;
}> | null {
  if (!values || typeof values !== "object") return null;
  const v = values as Record<string, unknown>;
  const todos = v.todos as unknown;
  if (!Array.isArray(todos)) return null;
  const out: Array<{ content: string; status: string }> = [];
  for (const t of todos) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    const content = o.content;
    const status = o.status;
    if (typeof content === "string" && typeof status === "string") {
      out.push({ content, status });
    }
  }
  return out.length ? out : null;
}

export async function POST(req: Request) {
  let body: DeepChatRequestBody;
  try {
    body = (await req.json()) as DeepChatRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const threadId = body.threadId?.trim();
  const message = body.message?.trim();
  if (!threadId) {
    return Response.json({ error: "threadId 不能为空" }, { status: 400 });
  }
  if (!message) {
    return Response.json({ error: "message 不能为空" }, { status: 400 });
  }

  try {
    const { agent } = createNextDeepChatAgent({
      enableWebSearch: Boolean(body.enableWebSearch),
    });
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };

        const skillPathsEmitted = new Set<string>();

        try {
          const input = {
            messages: [{ role: "user" as const, content: message }],
            /** 每轮附带 Skills 虚拟文件，由状态合并；体量小，避免首轮失败后未注入 */
            files: buildBundledSkillFiles(),
          };

          const iterable = await agent.stream(input as never, {
            streamMode: ["messages", "updates", "values"] as const,
            configurable: {
              thread_id: threadId,
            },
            recursionLimit: 64,
          });

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

              const messages = (payload as { messages?: unknown[] } | undefined)?.messages;
              if (Array.isArray(messages)) {
                const skillHits = extractSkillHitsFromMessages(messages);
                for (const hit of skillHits) {
                  if (skillPathsEmitted.has(hit.path)) continue;
                  skillPathsEmitted.add(hit.path);
                  send({
                    type: "trace",
                    kind: "skill",
                    title: `Skill：${hit.slug}`,
                    detail: `read_file → ${hit.path}`,
                    step,
                    skillSlug: hit.slug,
                    skillPath: hit.path,
                  });
                }

                const summary = summarizeToolCallsFromMessages(messages);
                if (summary?.names.length) {
                  send({
                    type: "trace",
                    kind: "tool",
                    title: `工具：${summary.names.join(", ")}`,
                    detail: summary.detail,
                    step,
                  });
                } else if (step) {
                  send({
                    type: "trace",
                    kind: "graph",
                    title: "图更新",
                    detail: `节点：${step}`,
                    step,
                  });
                }
              }
            } else if (mode === "values") {
              const todos = extractTodosFromValues(chunk);
              if (todos) {
                send({ type: "todos", items: todos });
                send({
                  type: "trace",
                  kind: "plan",
                  title: "规划（待办）",
                  detail: todos.map((t) => `${t.status}: ${t.content}`).join("\n"),
                });
              }
            }
          }

          send({ type: "done" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          send({ type: "error", message: msg });
        } finally {
          await flushLangSmithPendingTraces();
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
    const messageErr = err instanceof Error ? err.message : String(err);
    return Response.json({ error: messageErr }, { status: 500 });
  }
}
