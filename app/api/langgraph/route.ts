import { buildReflectionGraph } from "@/frameworks/langgraph/graph";

export const runtime = "nodejs";

type Body = {
  topic?: string;
  maxIterations?: number;
  targetScore?: number;
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

  const topic = (body.topic ?? "").trim();
  if (!topic) {
    return new Response(JSON.stringify({ error: "topic 不能为空" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const maxIterations = Math.max(1, Math.min(5, body.maxIterations ?? 3));
  const targetScore = Math.max(1, Math.min(10, body.targetScore ?? 8));

  const graph = buildReflectionGraph();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        send({ type: "start", topic, maxIterations, targetScore });

        const eventStream = await graph.stream(
          { topic, maxIterations, targetScore },
          { streamMode: "updates" },
        );

        for await (const update of eventStream) {
          for (const [node, payload] of Object.entries(update)) {
            send({ type: "node", node, payload });
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
