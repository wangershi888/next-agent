import { AIMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";
import { createQwenChatModel } from "../model/chat-models";
import {
  normalizeAshareCode,
  toEastmoneySecid,
} from "../lib/eastmoney-client";
import {
  createEastmoneyMarketDataTool,
  createEastmoneyStockNewsTool,
} from "@/tools/eastmoney-tools";

/**
 * 多 Agent 交易决策 — LangChain LCEL：
 * - 各阶段为 RunnableLambda（节点）
 * - 子链：ChatPromptTemplate.pipe(ChatModel) ≈ RunnableSequence.from([prompt, model])
 * - 整体：RunnableSequence.from([...]) ≈ r1.pipe(r2).pipe(r3)...
 */

export interface TradingPipelineInput {
  stockCode: string;
}

export interface TradingPipelineState extends TradingPipelineInput {
  secid: string;
  newsToolOutput?: string;
  marketToolOutput?: string;
  dataAnalyst?: string;
  technicalAnalyst?: string;
  riskControl?: string;
  tradingAgent?: string;
}

function aimessageText(msg: AIMessage): string {
  const c = msg.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((block) => {
        if (typeof block === "object" && block && "text" in block) {
          return String((block as { text?: string }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return String(c ?? "");
}

export function buildTradingDecisionRunnable() {
  const model = createQwenChatModel({ streaming: false, temperature: 0.35 });
  const newsTool = createEastmoneyStockNewsTool();
  const marketTool = createEastmoneyMarketDataTool();

  const normalizeStep = RunnableLambda.from(
    async (input: TradingPipelineInput): Promise<TradingPipelineState> => {
      const stockCode = normalizeAshareCode(input.stockCode);
      if (!/^\d{6}$/.test(stockCode)) {
        throw new Error("请输入 6 位 A 股代码（仅沪深主板/创业板等常规 6 位代码）");
      }
      const secid = toEastmoneySecid(stockCode);
      return { stockCode, secid };
    },
  ).withConfig({ runName: "node_normalize_code" });

  const dataAnalystStep = RunnableLambda.from(
    async (state: TradingPipelineState): Promise<TradingPipelineState> => {
      const newsToolOutput = String(
        await newsTool.invoke({ stock_code: state.stockCode }),
      );
      const prompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          "你是 A 股数据分析师。基于东方财富检索到的个股资讯做简短研判：利好/利空/中性，列出 2～4 条要点，勿编造接口中不存在的事实。输出简体中文。",
        ],
        [
          "human",
          "股票代码：{code}\n\n东方财富资讯工具输出：\n{news}\n\n请给出数据面与舆情小结（≤400 字）。",
        ],
      ]);
      const miniChain = RunnableSequence.from([prompt, model]).withConfig({
        runName: "lcel_prompt_pipe_model_data_analyst",
      });
      const msg = (await miniChain.invoke({
        code: state.stockCode,
        news: newsToolOutput,
      })) as AIMessage;
      return {
        ...state,
        newsToolOutput,
        dataAnalyst: aimessageText(msg),
      };
    },
  ).withConfig({ runName: "node_data_analyst_agent" });

  const technicalAnalystStep = RunnableLambda.from(
    async (state: TradingPipelineState): Promise<TradingPipelineState> => {
      const marketToolOutput = String(
        await marketTool.invoke({ stock_code: state.stockCode }),
      );
      const prompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          "你是 A 股技术分析师。基于快照与日线文本做简短技术面判断：趋势、关键价位感知、量价简述；勿编造数据中不存在的价格。输出简体中文。",
        ],
        [
          "human",
          "股票代码：{code}\n\n东方财富行情工具输出：\n{market}\n\n请给出技术面小结（≤400 字）。",
        ],
      ]);
      const miniChain = RunnableSequence.from([prompt, model]).withConfig({
        runName: "lcel_prompt_pipe_model_technical_analyst",
      });
      const msg = (await miniChain.invoke({
        code: state.stockCode,
        market: marketToolOutput,
      })) as AIMessage;
      return {
        ...state,
        marketToolOutput,
        technicalAnalyst: aimessageText(msg),
      };
    },
  ).withConfig({ runName: "node_technical_analyst_agent" });

  const riskStep = RunnableLambda.from(
    async (state: TradingPipelineState): Promise<TradingPipelineState> => {
      const prompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          "你是风险控制师。综合数据观点与技术面观点，给出倾向：买入/卖出/观望（三选一），并说明理由；给出「理想股价区间」（基于当前价的合理波动区间，可用文本区间）；若倾向为买入，同时给出参考止盈价与止损价（可为区间或单点）；若信息不足请明确假设。输出简体中文，条理清晰。",
        ],
        [
          "human",
          "股票代码：{code}\n\n【数据分析师】\n{data}\n\n【技术分析师】\n{tech}\n\n请输出风控结论。",
        ],
      ]);
      const miniChain = RunnableSequence.from([prompt, model]).withConfig({
        runName: "lcel_prompt_pipe_model_risk",
      });
      const msg = (await miniChain.invoke({
        code: state.stockCode,
        data: state.dataAnalyst ?? "",
        tech: state.technicalAnalyst ?? "",
      })) as AIMessage;
      return { ...state, riskControl: aimessageText(msg) };
    },
  ).withConfig({ runName: "node_risk_control_agent" });

  const tradingAgentStep = RunnableLambda.from(
    async (state: TradingPipelineState): Promise<TradingPipelineState> => {
      const prompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          "你是交易决策助手：把风控结论压缩成用户可执行的摘要（仍保持买入/卖出/观望），并用一两句话提示风险；不要引入新的数字除非风控文本已有。简体中文。",
        ],
        [
          "human",
          "股票代码：{code}\n\n【风控结论】\n{risk}\n\n请给出最终交易提示（≤250 字）。",
        ],
      ]);
      const miniChain = RunnableSequence.from([prompt, model]).withConfig({
        runName: "lcel_prompt_pipe_model_trading_agent",
      });
      const msg = (await miniChain.invoke({
        code: state.stockCode,
        risk: state.riskControl ?? "",
      })) as AIMessage;
      return { ...state, tradingAgent: aimessageText(msg) };
    },
  ).withConfig({ runName: "node_trading_agent" });

  const sequence = RunnableSequence.from([
    normalizeStep,
    dataAnalystStep,
    technicalAnalystStep,
    riskStep,
    tradingAgentStep,
  ]).withConfig({ runName: "trading_multi_agent_sequence" });

  return {
    sequence,
    pipedChain: normalizeStep
      .pipe(dataAnalystStep)
      .pipe(technicalAnalystStep)
      .pipe(riskStep)
      .pipe(tradingAgentStep),
    steps: {
      normalizeStep,
      dataAnalystStep,
      technicalAnalystStep,
      riskStep,
      tradingAgentStep,
    },
  };
}
