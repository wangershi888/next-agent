import { buildDebateGraph } from "@/frameworks/langgraph/graph";

export const runtime = "nodejs";

type Body = {
  topic?: string;
  redStance?: string;
  blueStance?: string;
  maxRounds?: number;
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
  const redStance = (body.redStance ?? "").trim();
  const blueStance = (body.blueStance ?? "").trim();
  if (!topic || !redStance || !blueStance) {
    return new Response(
      JSON.stringify({ error: "topic / redStance / blueStance 都不能为空" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  const maxRounds = Math.max(1, Math.min(5, body.maxRounds ?? 3));

  const graph = buildDebateGraph();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        send({ type: "start", topic, redStance, blueStance, maxRounds });

        const eventStream = await graph.stream(
          { topic, redStance, blueStance, maxRounds },
          { streamMode: "updates", recursionLimit: 50 },
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
