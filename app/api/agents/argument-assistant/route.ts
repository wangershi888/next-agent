import {
  INTERRUPT,
  isInterrupted,
} from "@langchain/langgraph";
import {
  getArgumentAssistantGraph,
  resumeCommand,
} from "@/frameworks/langgraph/graphs/argument-assistant-graph";
import type { ArgumentAssistantRequestBody } from "@/lib/types/chat";
import { flushLangSmithPendingTraces } from "@/lib/observability/langsmith";

export const runtime = "nodejs";
export const maxDuration = 120;

function formatRouteError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  let m = err.message || String(err);
  const c = err.cause;
  if (c instanceof Error) {
    m += ` | ${c.message}`;
  } else if (c != null) {
    m += ` | ${String(c)}`;
  }
  return m;
}

export async function POST(req: Request) {
  let body: ArgumentAssistantRequestBody;
  try {
    body = (await req.json()) as ArgumentAssistantRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const threadId = body.threadId?.trim();
  if (!threadId) {
    return Response.json({ error: "threadId 不能为空" }, { status: 400 });
  }

  const { compiled } = getArgumentAssistantGraph();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      try {
        const configurable = {
          thread_id: threadId,
          recursionLimit: 48,
        };

        const streamInput =
          body.phase === "resume"
            ? resumeCommand(body.resume)
            : {
                topic: body.topic.trim(),
                passThreshold: body.passThreshold ?? 9,
                maxIterations: body.maxIterations ?? 5,
                revisionCount: 0,
                draft: "",
                score: null,
                scorerFeedback: "",
                passed: false,
                passAdvice: "",
                aborted: false,
              };

        if (body.phase !== "resume") {
          if (!body.topic?.trim()) {
            send({ type: "error", message: "topic 不能为空" });
            controller.close();
            return;
          }
        }

        const iterable = await compiled.stream(streamInput as never, {
          streamMode: ["values", "updates"] as const,
          configurable,
        });

        for await (const chunk of iterable) {
          if (!Array.isArray(chunk) || chunk.length < 2) continue;
          const [mode, payload] = chunk as [string, unknown];

          if (mode === "values" && payload && typeof payload === "object") {
            if (isInterrupted(payload)) {
              const list = (payload as Record<string, unknown>)[INTERRUPT];
              const first =
                Array.isArray(list) && list.length > 0
                  ? (list[0] as { value?: unknown })?.value
                  : undefined;
              send({
                type: "interrupt",
                payload: first,
              });
            } else {
              send({ type: "values", state: payload });
            }
          } else if (mode === "updates" && payload && typeof payload === "object") {
            send({ type: "updates", partial: payload });
          }
        }

        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: formatRouteError(err) });
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
}
