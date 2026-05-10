import { buildTradingDecisionRunnable } from "@/frameworks/langchain/chains/trading-decision-chain";
import type { TradingDecisionRequestBody } from "@/lib/types/chat";
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
  if (/fetch failed/i.test(m) && !/东方财富|DashScope|通义|compatible-mode/i.test(m)) {
    m +=
      "（多为服务端无法访问外网或 HTTPS：请检查代理/VPN、防火墙，以及 DASHSCOPE_API_KEY 是否有效。）";
  }
  return m;
}

export async function POST(req: Request) {
  let body: TradingDecisionRequestBody;
  try {
    body = (await req.json()) as TradingDecisionRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = body.stockCode?.trim();
  if (!raw) {
    return Response.json({ error: "stockCode 不能为空" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      try {
        const { steps } = buildTradingDecisionRunnable();

        let state = await steps.normalizeStep.invoke({ stockCode: raw });
        send({
          type: "step",
          key: "normalize",
          title: "节点：规范化股票代码（RunnableLambda）",
          payload: {
            stockCode: state.stockCode,
            secid: state.secid,
          },
        });

        state = await steps.dataAnalystStep.invoke(state);
        send({
          type: "step",
          key: "data_analyst",
          title: "节点：数据分析师（工具 eastmoney_stock_news + LCEL）",
          payload: {
            toolName: "eastmoney_stock_news",
            toolOutput: state.newsToolOutput ?? "",
            nodeOutput: state.dataAnalyst ?? "",
          },
        });

        state = await steps.technicalAnalystStep.invoke(state);
        send({
          type: "step",
          key: "technical_analyst",
          title: "节点：技术分析师（工具 eastmoney_stock_market_data + LCEL）",
          payload: {
            toolName: "eastmoney_stock_market_data",
            toolOutput: state.marketToolOutput ?? "",
            nodeOutput: state.technicalAnalyst ?? "",
          },
        });

        state = await steps.riskStep.invoke(state);
        send({
          type: "step",
          key: "risk_control",
          title: "节点：风险控制师（RunnableSequence: ChatPromptTemplate.pipe(model)）",
          payload: {
            nodeOutput: state.riskControl ?? "",
          },
        });

        state = await steps.tradingAgentStep.invoke(state);
        send({
          type: "step",
          key: "trading_agent",
          title: "节点：交易决策 Agent",
          payload: {
            nodeOutput: state.tradingAgent ?? "",
          },
        });

        send({
          type: "result",
          title: "完整状态（最终 RunnableSequence 输出）",
          payload: state,
        });

        send({
          type: "meta",
          message:
            "LangChain：RunnableSequence.from([...]) 等价 normalize.pipe(data).pipe(tech).pipe(risk).pipe(trade)；链路定义见 frameworks/langchain/chains/trading-decision-chain.ts。",
        });

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
