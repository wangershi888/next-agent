import {
  buildResearchAgent,
  buildUserMessage,
} from "@/frameworks/deepagent/agent";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  product?: string;
  audience?: string;
  focus?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonError("无效的 JSON 请求", 400);
  }

  const product = (body.product ?? "").trim();
  if (!product) return jsonError("product 不能为空", 400);
  const audience = (body.audience ?? "投资人 / 产品负责人").trim();
  const focus = (body.focus ?? "市场地位 + 财务画像").trim();

  const agent = buildResearchAgent();
  const userMessage = buildUserMessage({ product, audience, focus });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        send({ type: "start", product, audience, focus });

        const eventStream = await agent.stream(
          { messages: [{ role: "user", content: userMessage }] },
          { streamMode: "updates", recursionLimit: 80 },
        );

        for await (const update of eventStream) {
          for (const [node, payload] of Object.entries(update)) {
            send({ type: "update", node, payload: serialize(payload) });
          }
        }

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

function jsonError(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * 把 LangGraph state 更新里的 BaseMessage / 复杂对象拍平成可 JSON 序列化的结构。
 * 只保留前端需要展示的字段，避免大对象 + 循环引用。
 */
function serialize(payload: any): any {
  if (payload == null) return payload;
  const out: Record<string, any> = {};

  if (Array.isArray(payload?.messages)) {
    out.messages = payload.messages.map((m: any) => ({
      role: m?.getType?.() ?? m?.role ?? m?._getType?.() ?? "unknown",
      content: typeof m?.content === "string" ? m.content : safeStringify(m?.content),
      name: m?.name,
      tool_calls: Array.isArray(m?.tool_calls)
        ? m.tool_calls.map((tc: any) => ({
            id: tc.id,
            name: tc.name,
            args: tc.args,
          }))
        : undefined,
      tool_call_id: m?.tool_call_id,
    }));
  }
  if (Array.isArray(payload?.todos)) {
    out.todos = payload.todos.map((t: any) => ({
      content: t?.content ?? t?.text ?? "",
      status: t?.status ?? "pending",
    }));
  }
  if (payload?.files && typeof payload.files === "object") {
    out.files = {} as Record<string, string>;
    for (const [name, content] of Object.entries(payload.files)) {
      out.files[name] =
        typeof content === "string" ? content : safeStringify(content);
    }
  }
  return out;
}

function safeStringify(v: any) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
