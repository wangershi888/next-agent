import { tool } from "langchain";
import * as z from "zod";
import {
  fetchEastmoneyMarketSnapshot,
  fetchEastmoneyStockNews,
  normalizeAshareCode,
  toEastmoneySecid,
} from "@/frameworks/langchain/lib/eastmoney-client";

export function createEastmoneyStockNewsTool() {
  return tool(
    async ({ stock_code }: { stock_code: string }) => {
      const code = normalizeAshareCode(stock_code);
      return await fetchEastmoneyStockNews(code);
    },
    {
      name: "eastmoney_stock_news",
      description:
        "根据 6 位 A 股代码，从东方财富检索该股相关新闻/公告摘要（cms 资讯），用于基本面与舆情分析。",
      schema: z.object({
        stock_code: z.string().describe("6 位数字股票代码，如 600519"),
      }),
    },
  );
}

export function createEastmoneyMarketDataTool() {
  return tool(
    async ({ stock_code }: { stock_code: string }) => {
      const code = normalizeAshareCode(stock_code);
      const secid = toEastmoneySecid(code);
      return await fetchEastmoneyMarketSnapshot(secid);
    },
    {
      name: "eastmoney_stock_market_data",
      description:
        "根据 6 位 A 股代码，从东方财富获取实时行情快照与近日日 K 线文本，用于技术面分析。",
      schema: z.object({
        stock_code: z.string().describe("6 位数字股票代码"),
      }),
    },
  );
}
