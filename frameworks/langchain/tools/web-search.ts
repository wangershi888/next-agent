import { tool } from "langchain";
import * as z from "zod";

interface TavilySearchResponse {
  results?: Array<{ title?: string; url?: string; content?: string }>;
  answer?: string;
}

/**
 * Tavily 联网搜索（仅通过 LangChain `tool` 封装，便于接入 `createAgent`）。
 * 密钥：`TAVILY_API_KEY`
 */
export function createTavilyWebSearchTool(apiKey: string) {
  return tool(
    async ({ query }: { query: string }) => {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: "basic",
          max_results: 5,
          include_answer: true,
        }),
      });

      if (!res.ok) {
        return `Tavily 请求失败：HTTP ${res.status}`;
      }

      const data = (await res.json()) as TavilySearchResponse;
      const lines: string[] = [];
      if (data.answer) {
        lines.push(`摘要：${data.answer}`);
      }
      if (data.results?.length) {
        for (const r of data.results) {
          lines.push(
            `- ${r.title ?? "(无标题)"}: ${r.content ?? ""} ${r.url ? `(${r.url})` : ""}`.trim(),
          );
        }
      }
      return lines.length ? lines.join("\n") : "未找到相关结果。";
    },
    {
      name: "web_search",
      description:
        "在互联网上检索最新信息。当用户问题涉及时效性、新闻、实时数据，与时间日期相关的信息或你不确定的事实时使用。",
      schema: z.object({
        query: z.string().describe("面向搜索引擎的简短查询语句"),
      }),
    },
  );
}
