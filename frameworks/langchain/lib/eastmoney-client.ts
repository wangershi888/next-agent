import { fetchWithRetry } from "./fetch-util";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function normalizeAshareCode(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 6) return digits.slice(-6);
  return digits.padStart(6, "0");
}

export function toEastmoneySecid(code6: string): string {
  const c = code6.padStart(6, "0");
  return c.startsWith("6") ? `1.${c}` : `0.${c}`;
}

function stripEm(s: string): string {
  return s.replace(/<\/?em>/gi, "");
}

function parseJsonp(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf("(");
  const end = trimmed.lastIndexOf(")");
  if (start < 0 || end <= start) {
    throw new Error("东方财富返回非 JSONP 格式");
  }
  return JSON.parse(trimmed.slice(start + 1, end)) as unknown;
}

function quotePageReferer(secid: string): string {
  const [m, code] = secid.split(".");
  const prefix = m === "1" ? "sh" : "sz";
  return `https://quote.eastmoney.com/${prefix}${code}.html`;
}

export async function fetchEastmoneyStockNews(stockCode: string): Promise<string> {
  const innerParam = {
    uid: "",
    keyword: stockCode,
    type: ["cmsArticleWebOld"],
    client: "web",
    clientType: "web",
    clientVersion: "curr",
    param: {
      cmsArticleWebOld: {
        searchScope: "default",
        sort: "default",
        pageIndex: 1,
        pageSize: 12,
        preTag: "",
        postTag: "",
      },
    },
  };
  const qs = new URLSearchParams({
    cb: "jcb",
    param: JSON.stringify(innerParam),
  });
  const url = `https://search-api-web.eastmoney.com/search/jsonp?${qs.toString()}`;
  const res = await fetchWithRetry(
    url,
    {
      headers: {
        Referer: `https://so.eastmoney.com/news/s?keyword=${encodeURIComponent(stockCode)}`,
        "User-Agent": UA,
        Accept: "*/*",
      },
    },
    "东方财富个股资讯(search-api-web)",
  );
  if (!res.ok) {
    return `个股资讯请求失败：HTTP ${res.status}`;
  }
  const text = await res.text();
  let data: { code?: number; msg?: string; result?: { cmsArticleWebOld?: unknown[] } };
  try {
    data = parseJsonp(text) as typeof data;
  } catch {
    return `解析个股资讯失败：${text.slice(0, 200)}`;
  }
  if (data.code !== 0 || !data.result?.cmsArticleWebOld?.length) {
    return `未检索到个股资讯（${data.msg ?? "无数据"}）。`;
  }
  const lines: string[] = [];
  for (const row of data.result.cmsArticleWebOld.slice(0, 12)) {
    const r = row as {
      date?: string;
      title?: string;
      content?: string;
      mediaName?: string;
      url?: string;
    };
    lines.push(
      [
        `- ${stripEm(r.title ?? "")}`,
        `  时间：${r.date ?? "-"}`,
        `  摘要：${stripEm((r.content ?? "").slice(0, 240))}${(r.content?.length ?? 0) > 240 ? "…" : ""}`,
        `  来源：${r.mediaName ?? "-"}`,
        r.url ? `  链接：${r.url}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return lines.join("\n\n");
}

export async function fetchEastmoneyMarketSnapshot(secid: string): Promise<string> {
  const quoteFields = "f43,f44,f45,f46,f47,f48,f57,f58,f60,f170,f116,f161,f162,f164";
  const quoteUrl = `https://push2.eastmoney.com/api/qt/stock/get?fltt=2&invt=2&fields=${quoteFields}&secid=${secid}`;
  const klinePath =
    `api/qt/stock/kline/get?fields1=f1,f2,f3,f4,f5,f6,f7,f8` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&secid=${secid}&klt=101&fqt=1&beg=0&end=20500101&lmt=35`;

  const pageRef = quotePageReferer(secid);
  const quoteHeaders: HeadersInit = {
    "User-Agent": UA,
    Accept: "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    Referer: pageRef,
    Origin: "https://quote.eastmoney.com",
  };
  const klineHeaders: HeadersInit = {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    Referer: pageRef,
    Origin: "https://quote.eastmoney.com",
  };

  const parts: string[] = [];

  try {
    const qRes = await fetchWithRetry(
      quoteUrl,
      { headers: quoteHeaders },
      "东方财富行情快照(push2)",
      25_000,
      3,
    );
    if (qRes.ok) {
      const q = (await qRes.json()) as {
        data?: Record<string, number | string>;
      };
      const d = q.data;
      if (d && typeof d === "object") {
        const name = String(d.f58 ?? "");
        const code = String(d.f57 ?? "");
        parts.push(
          [
            `【快照】${name}（${code}）`,
            `昨收：${d.f60 ?? "-"}`,
            `今开：${d.f46 ?? "-"}  最高：${d.f44 ?? "-"}  最低：${d.f45 ?? "-"}`,
            `最新：${d.f43 ?? "-"}  涨跌幅(%)：${d.f170 ?? "-"}`,
            `成交额：${d.f48 ?? "-"}  成交量(手)：${d.f47 ?? "-"}`,
            `总市值：${d.f116 ?? "-"}  市盈率(动/静/TTM)：${d.f162 ?? "-"}/${d.f161 ?? "-"}/${d.f164 ?? "-"}`,
          ].join("\n"),
        );
      } else {
        parts.push("【快照】无数据或代码无效。");
      }
    } else {
      parts.push(`【快照】请求失败 HTTP ${qRes.status}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    parts.push(`【快照】获取失败：${msg}`);
  }

  const klineHosts = [
    "https://push2his.eastmoney.com",
    "https://7.push2his.eastmoney.com",
    "https://19.push2his.eastmoney.com",
  ];

  let klineOk = false;
  for (const host of klineHosts) {
    const klineUrl = `${host}/${klinePath}`;
    try {
      const kRes = await fetchWithRetry(
        klineUrl,
        { headers: klineHeaders },
        "东方财富日K线(push2his)",
        25_000,
        3,
      );
      if (!kRes.ok) {
        parts.push(`\n【近日日线】HTTP ${kRes.status}（${host}）`);
        continue;
      }
      const k = (await kRes.json()) as {
        data?: { klines?: string[] };
      };
      const kl = k.data?.klines?.slice(-15) ?? [];
      if (kl.length) {
        parts.push("\n【近日日线】（逗号分隔字段：日期、开收高低量额等，节选）");
        for (const row of kl) {
          const cols = row.split(",");
          if (cols.length >= 2) {
            parts.push(`${cols[0]}  ${cols.slice(1, 7).join(" | ")}`);
          }
        }
        klineOk = true;
        break;
      }
      parts.push(`\n【近日日线】${host} 返回无 K 线数据，尝试备用域名…`);
      continue;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      parts.push(`\n【近日日线】${host} 失败：${msg}`);
    }
  }

  if (!klineOk) {
    parts.push(
      "\n【近日日线】全部节点不可用，已降级：技术分析请主要依据上方「快照」；若需日线请稍后重试或检查网络/代理。",
    );
  }

  return parts.join("\n");
}
