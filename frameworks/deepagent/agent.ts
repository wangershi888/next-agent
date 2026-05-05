/**
 * DeepAgent demo —— "竞品调研报告代理"。
 *
 * 这是 DeepAgent "四件套" 的全面升级版：
 *   1. 规划工具：内置 `write_todos`，主 Agent 会先把任务拆成 8 条 TODO 再动手。
 *   2. 子 Agent：6 个专属 sub-agent（产品研究 / 市场分析 / 财务分析 / SWOT /
 *      报告撰稿 / 事实核查），上下文相互隔离。
 *   3. 文件系统：内置 `write_file` / `read_file`，多个中间交付物
 *      (research-notes.md / market-analysis.md / financial-snapshot.md / swot.md
 *      / draft-report.md / fact-check-notes.md / final-report.md) 在 sub-agent 间
 *      作为消息载体接力传递。
 *   4. 详细系统提示 + 自定义工具：
 *      - `knowledge_lookup(topic, aspect)`：mock 行业知识库
 *      - `compute_metric(name, formula, inputs)`：数值计算（市场规模 / 增长 / 估值）
 *
 * 工作流（主 agent 严格按顺序推进，最后还有一次审查 → 修订 → 终稿循环）：
 *
 *   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
 *   │ product-researcher│ │ market-analyst   │ │ financial-analyst│
 *   │  research-notes.md│ │  market-analysis │ │ financial-snap...│
 *   └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
 *            ▼                     ▼                     ▼
 *                       (read 上述三个文件)
 *            ┌──────────────────────────────────┐
 *            │     swot-analyst → swot.md       │
 *            └──────────────────┬───────────────┘
 *                               ▼
 *            ┌──────────────────────────────────┐
 *            │ report-writer → draft-report.md  │
 *            └──────────────────┬───────────────┘
 *                               ▼
 *            ┌──────────────────────────────────┐
 *            │ fact-checker → fact-check-notes  │
 *            └──────────────────┬───────────────┘
 *                               ▼
 *            主 agent 综合 fact-check-notes 修订
 *                  → final-report.md
 */
import { ChatDeepSeek } from "@langchain/deepseek";
import { tool } from "@langchain/core/tools";
import { createDeepAgent, type SubAgent } from "deepagents";
import { z } from "zod";

// ============== Mock 知识库 ==============

type Aspect =
  | "product_overview"
  | "target_users"
  | "tech_stack"
  | "market_size"
  | "competitors"
  | "pricing"
  | "recent_funding";

type KbEntry = Partial<Record<Aspect, string>>;

const MOCK_KB: Record<string, KbEntry> = {
  notion: {
    product_overview:
      "Notion 是 all-in-one 协作工作空间，把笔记 / Wiki / 数据库 / 项目管理整合在一个页面树里。最近 2024 年推出 Notion AI 与 Calendar，向 vertical SaaS 方向延伸。",
    target_users:
      "中小创业团队（5-200 人）为主，近年企业版（Enterprise）渗透到 Fortune 500 团队，典型用户是产研 / 市场 / 运营。",
    tech_stack:
      "前端 React + 自研 Block-based 编辑器 (类 ProseMirror)；后端 Node.js + PostgreSQL；近期把搜索后端从 Elasticsearch 迁到了 Trieve / 自研向量索引。",
    market_size:
      "协作 / 知识管理软件全球市场 2024 ≈ $90B，CAGR 13%。直接对手 Confluence、ClickUp、Coda；加上 AI 笔记类则与 Mem / Roam / Obsidian 局部重叠。",
    competitors: "Confluence、ClickUp、Coda、Mem、Obsidian、Linear（部分项目场景）",
    pricing:
      "Free / Plus $10/mo/seat / Business $18 / Enterprise 议价；AI add-on $10/seat。",
    recent_funding:
      "2021 C 轮 $275M，估值 $10B；2024 年传 Notion AI ARR 触达 $200M。",
  },
  linear: {
    product_overview:
      "Linear 是面向高速研发团队的 issue tracker，主打『极致键盘流 + 轻量级 SDLC』，逐步把 Cycle / Project 抽象做深。2024 推出 Linear Asks（IT support）+ AI Agents。",
    target_users:
      "工程团队 50-500 人的早中期 SaaS / Fintech。CTO + 工程负责人是关键决策者。",
    tech_stack:
      "TypeScript 全栈；GraphQL + 自研同步引擎；Postgres + Redis；客户端 React + 自研 ProseMirror。",
    market_size:
      "项目 / issue 管理细分市场 ≈ $12B，CAGR 11%。Jira 占 ~45% 份额是绝对领头。",
    competitors: "Jira、Asana、Shortcut、Height、GitHub Projects",
    pricing: "Free / Standard $8 / Plus $12 / Enterprise 议价",
    recent_funding:
      "2024 C 轮 $80M，估值 $1.25B，营收估约 $50-80M ARR。",
  },
  figma: {
    product_overview:
      "Figma 是协作式设计工具，浏览器原生、多人实时协同。2023 推出 FigJam（白板）、2024 推出 Dev Mode + Figma AI（自动布局生成）。",
    target_users:
      "数字产品设计师与产品经理，覆盖个人到 Fortune 500 设计组织。",
    tech_stack:
      "WebAssembly + WebGL 渲染引擎（C++ 编译到 WASM），Rust 协同引擎，Postgres + 自研对象数据库。",
    market_size:
      "设计工具全球市场 ≈ $30B，CAGR 17%。Adobe 全家桶仍主导但逐步被蚕食。",
    competitors: "Adobe XD（已停服）、Sketch、Framer、Penpot、Canva（局部）",
    pricing: "Free / Pro $15 / Org $45 / Enterprise $75，按编辑席位收费。",
    recent_funding:
      "Adobe 收购案被欧盟 / 英国监管否决后取消，2024 年 IPO 准备中，最新估值约 $12.5B。",
  },
};

// ============== 自定义工具 1：knowledge_lookup ==============

const knowledgeLookupTool = tool(
  async (input) => {
    const { topic, aspect } = input as { topic: string; aspect: Aspect };
    const key = topic.trim().toLowerCase();
    const entry = MOCK_KB[key];
    if (entry && entry[aspect]) {
      return JSON.stringify({
        topic,
        aspect,
        source: "internal_knowledge_base",
        content: entry[aspect],
      });
    }
    // 未收录：让 sub-agent 知道需要用一般性推断
    return JSON.stringify({
      topic,
      aspect,
      source: "fallback_template",
      content:
        `[知识库未直接收录 ${topic} 的 ${aspect}] ` +
        "请基于行业一般规律和你已掌握的公开信息合理推断，并在输出里明确标注「估计 / 推测」。",
    });
  },
  {
    name: "knowledge_lookup",
    description:
      "查询内部知识库获取产品 / 公司 / 行业的事实数据。" +
      "topic 是产品 / 公司名（小写匹配 notion / linear / figma 等）；" +
      "aspect 必须是以下之一：product_overview / target_users / tech_stack / " +
      "market_size / competitors / pricing / recent_funding。" +
      "未命中会返回 fallback_template，提示要标注推测。",
    schema: z.object({
      topic: z.string().describe("产品 / 公司名，例如 Notion / Linear / Figma"),
      aspect: z
        .enum([
          "product_overview",
          "target_users",
          "tech_stack",
          "market_size",
          "competitors",
          "pricing",
          "recent_funding",
        ])
        .describe("要查询的方面"),
    }),
  },
);

// ============== 自定义工具 2：compute_metric ==============

const computeMetricTool = tool(
  async (input) => {
    const { name, formula, inputs } = input as {
      name: string;
      formula: string;
      inputs: Record<string, number>;
    };
    let expr = formula;
    // 简单变量替换：把 inputs 里的 key 替换成数值
    const sortedKeys = Object.keys(inputs).sort((a, b) => b.length - a.length);
    for (const k of sortedKeys) {
      expr = expr.replace(new RegExp(`\\b${k}\\b`, "g"), String(inputs[k]));
    }
    try {
      // 仅支持加减乘除和括号；保险起见拒绝包含字母 / 函数调用的表达式
      if (!/^[\d+\-*/().\s,e]+$/.test(expr)) {
        return JSON.stringify({
          name,
          formula,
          inputs,
          error: `非法表达式：替换后存在非数值字符 → ${expr}`,
        });
      }
      const result = Function(`"use strict"; return (${expr});`)();
      return JSON.stringify({
        name,
        formula,
        inputs,
        substituted: expr,
        result,
        formatted:
          typeof result === "number"
            ? formatNumber(result)
            : String(result),
      });
    } catch (err) {
      return JSON.stringify({
        name,
        formula,
        inputs,
        error: err instanceof Error ? err.message : "compute failed",
      });
    }
  },
  {
    name: "compute_metric",
    description:
      "数值计算工具。formula 是只含加减乘除和括号的表达式，例如 'tam * sam_ratio * som_ratio'；" +
      "inputs 给出公式里所有变量的具体数值；name 是这次计算的标签（市场规模 / 估值倍数 等）。" +
      "返回 JSON：{ name, formula, inputs, substituted, result, formatted }。",
    schema: z.object({
      name: z.string().describe("计算的标签，比如 'TAM' / '5 年 ARR 预测' / 'P/S ratio'"),
      formula: z.string().describe("形如 'a * b + c' 的表达式，只支持 + - * / ( )"),
      inputs: z
        .record(z.string(), z.number())
        .describe("变量到数值的映射，例如 { tam: 90, sam_ratio: 0.3 }"),
    }),
  },
);

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

// ============== 自定义工具 3：record_decision ==============
//
// 这是真正体现「自主决策」的工具：每个十字路口主 agent / sub-agent 必须先调用
// 它把"我面对什么选项 → 选了哪个 → 因为什么"外化出来，再去执行具体操作。
// 这样可观察、可审计，audience 能清楚看到 agent 在 *决策*，而不是按脚本走。

const recordDecisionTool = tool(
  async (input) => {
    const { situation, options, choice, reason, confidence } = input as {
      situation: string;
      options: string[];
      choice: string;
      reason: string;
      confidence: "high" | "medium" | "low";
    };
    const stamp = new Date().toISOString().slice(11, 19);
    return JSON.stringify({
      ok: true,
      logged_at: stamp,
      situation,
      options,
      choice,
      reason,
      confidence,
      note: "决策已记录到决策日志。继续执行你选择的方案即可。",
    });
  },
  {
    name: "record_decision",
    description:
      "在做关键决策前调用此工具，把『面对什么情况 / 有哪些选项 / 选了哪个 / 为什么 / 置信度』显式记录下来。" +
      "适用场景：决定要不要调某个 sub-agent、决定调几次、决定是否跳过某步、决定 fact-check 后修订还是重做、决定何时收尾。" +
      "**这是必填动作**：每次分叉前必须先 record_decision，再执行具体操作。",
    schema: z.object({
      situation: z.string().describe("当前面临的情境，1-2 句话"),
      options: z
        .array(z.string())
        .min(2)
        .describe("你在权衡的至少 2 个候选方案"),
      choice: z.string().describe("最终选了哪个（必须是 options 之一或它们的组合）"),
      reason: z.string().describe("选择理由，要具体引用前面收到的事实 / 数据"),
      confidence: z
        .enum(["high", "medium", "low"])
        .describe("对这个决策的置信度"),
    }),
  },
);

// ============== 模型 ==============

function buildModel() {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error(
      "缺少 DEEPSEEK_API_KEY 环境变量，请在项目根目录创建 .env.local 并配置。",
    );
  }
  return new ChatDeepSeek({
    model:
      process.env.DEEPSEEK_MODEL_PRO ??
      process.env.DEEPSEEK_MODEL ??
      "deepseek-v4-pro",
    apiKey: process.env.DEEPSEEK_API_KEY,
    configuration: process.env.DEEPSEEK_API_BASE
      ? { baseURL: process.env.DEEPSEEK_API_BASE }
      : undefined,
    temperature: 0.3,
    modelKwargs: { thinking: { type: "disabled" } },
  });
}

// ============== 6 个 Sub Agents（开放式：只给目标 + 价值观，不给步骤） ==============

const SUBAGENT_COMMON_TAIL =
  "\n\n**自主性要求**：调用工具的次数 / 顺序由你自己判断；如果某次工具返回的信息不足，自己决定再补一次还是用现有信息推断。" +
  "在每个分叉点（要不要再查一次 / 要不要切换 aspect / 要不要算第二个公式）务必先调用 `record_decision` 记录判断。" +
  "完成后用 ≤ 2 句话回复主 agent，包含「我做了什么 + 你可以信任的程度（高 / 中 / 低）」。";

const productResearcher: SubAgent = {
  name: "product-researcher",
  description:
    "产品研究员。给你一个产品名，你独立完成产品速写并写入 research-notes.md。" +
    "**你自己决定**查询哪些 aspect、查几次、信息够不够、是否需要再补一次。",
  systemPrompt:
    "你是产品研究员。**目标**：用 `write_file` 输出一份对得起读者的 `research-notes.md`，让下游分析师能据此工作。\n\n" +
    "**可用工具**：`knowledge_lookup`（aspect 任选）/ `write_file` / `read_file` / `record_decision`。\n\n" +
    "**质量底线**：信息不能空，但可以「诚实地少」。每个断言要么有 knowledge_lookup 引用，要么标「估计」。\n\n" +
    "**你需要自己判断**：要查哪几个 aspect？某个 aspect 返回 fallback_template 时是再查一次别的入口，还是接受不确定性？要不要参考已有的同行业产品做对比？" +
    SUBAGENT_COMMON_TAIL,
};

const marketAnalyst: SubAgent = {
  name: "market-analyst",
  description:
    "市场分析师。**你自己决定**要不要做 TAM/SAM/SOM、要不要看竞争格局、要算几个公式。" +
    "最终输出 market-analysis.md。",
  systemPrompt:
    "你是市场分析师，风格务实。**目标**：写 `market-analysis.md`，让读者一眼看出市场规模量级 + 关键玩家。\n\n" +
    "**可用工具**：`knowledge_lookup` / `compute_metric` / `read_file`（先读 research-notes.md 获取上下文）/ `write_file` / `record_decision`。\n\n" +
    "**你需要自己判断**：\n" +
    "- 这次研究的产品所在市场，是先看大盘 (TAM) 还是直接看可达市场 (SAM)？\n" +
    "- compute_metric 要算 1 次还是多次？算什么口径最关键？\n" +
    "- 竞争格局是泛泛列玩家就行，还是需要分层（直接对手 / 间接对手 / 替代品）？\n" +
    SUBAGENT_COMMON_TAIL,
};

const financialAnalyst: SubAgent = {
  name: "financial-analyst",
  description:
    "财务分析师。**你自己决定**要看融资 / 营收 / 估值哪几个方面，做几次计算。" +
    "最终输出 financial-snapshot.md。",
  systemPrompt:
    "你是财务分析师，风格保守。**目标**：写 `financial-snapshot.md`，让读者对量级有信心，对未知部分诚实。\n\n" +
    "**可用工具**：`knowledge_lookup`（aspect=recent_funding）/ `compute_metric` / `read_file` / `write_file` / `record_decision`。\n\n" +
    "**你需要自己判断**：当 recent_funding 给的数据稀疏时，是基于行业一般 P/S 比推算估值，还是干脆给一个区间？" +
    "compute_metric 算几次？哪个口径最有说服力（ARR 估算 / 倍数 / 5 年情景）？" +
    SUBAGENT_COMMON_TAIL,
};

const swotAnalyst: SubAgent = {
  name: "swot-analyst",
  description:
    "SWOT 分析师。综合已有文件给出 SWOT 矩阵；**你自己决定**要参考哪些文件、4 格之间是否需要交叉引用。",
  systemPrompt:
    "你是战略分析师。**目标**：写 `swot.md`，包含 4 格表格 + 一段「关键战略含义」总结。\n\n" +
    "**可用工具**：`read_file` / `write_file` / `record_decision`。\n\n" +
    "**你需要自己判断**：\n" +
    "- 4 格里每条至少 3 条吗？还是某几格本来就该比另一格更长？\n" +
    "- 哪些观察可以把市场 + 财务 + 产品三条线索交叉引用？\n" +
    SUBAGENT_COMMON_TAIL,
};

const reportWriter: SubAgent = {
  name: "report-writer",
  description:
    "报告撰稿人。把已有文件整合成 draft-report.md。" +
    "**你自己决定**报告结构、章节顺序、要不要写执行摘要、是否引用每个源文件。",
  systemPrompt:
    "你是 McKinsey 风格的撰稿人，文风克制。**目标**：写 `draft-report.md`，让 5 分钟阅读时间的读者能拿走 3 条洞察。\n\n" +
    "**可用工具**：`read_file` / `write_file` / `record_decision`。\n\n" +
    "**你需要自己判断**：\n" +
    "- 是按「产品 → 市场 → 财务 → SWOT → 建议」线性结构，还是先抛 3 条结论再展开？\n" +
    "- 哪些数字值得放进执行摘要？哪些放正文够？\n" +
    "- 战略建议要列多少条？" +
    SUBAGENT_COMMON_TAIL,
};

const factChecker: SubAgent = {
  name: "fact-checker",
  description:
    "事实核查员。读 draft-report.md + 所有依据文件，输出 fact-check-notes.md。" +
    "**关键**：你必须给出严重等级 (high/medium/low) 和明确建议（自行修订 / 重调 sub-agent / 已达标可发版），主 agent 会按你的建议决定下一步。",
  systemPrompt:
    "你是事实核查员，态度严苛。**目标**：写 `fact-check-notes.md`，让主 agent 可以仅凭这份笔记就做出下一步决策。\n\n" +
    "**可用工具**：`read_file` / `knowledge_lookup`（用于复核数字）/ `write_file` / `record_decision`。\n\n" +
    "**输出格式（必须严格遵守）**：\n" +
    "```\n" +
    "## 严重等级\n" +
    "<high | medium | low | none>\n\n" +
    "## 建议主 agent 下一步行动\n" +
    "<以下三选一>\n" +
    "- 「**已达标可发版**」（low / none 时）\n" +
    "- 「**自行修订**」（medium：仅文字 / 数字小错，主 agent 直接改 draft 即可）\n" +
    "- 「**重调 <子 agent 名>**」（high：数据来源有误 / 章节缺失，需要某个专家重新做）\n\n" +
    "## 问题清单（按优先级）\n" +
    "- [严重度] 问题描述 → 修复建议\n" +
    "- ...\n" +
    "```\n\n" +
    "**你需要自己判断**：\n" +
    "- 哪些数字需要 knowledge_lookup 复核？（不必每个都查，只查最关键的 1-2 个）\n" +
    "- 严重等级如何定？看证据强度，不要为了找问题而找问题。\n" +
    "- 如果发现严重错误（数字与源文件不一致），明确指出该重调哪个子 agent。\n\n" +
    "**严格自律**：在评级前先 `record_decision`，让主 agent 看到你给出 high/medium/low 的依据。",
};

const SUBAGENTS = [
  productResearcher,
  marketAnalyst,
  financialAnalyst,
  swotAnalyst,
  reportWriter,
  factChecker,
];

// ============== 主 agent 系统提示（开放式 / 目标导向） ==============
//
// 这份 prompt 里**故意没有**「第一步、第二步、第三步」的脚本式列表。
// 我们只描述：你的角色、你的资源、你的价值观、可能遇到的十字路口。
// 真正怎么做、做几遍、调几个 sub-agent，完全由 agent 自己决定。
// 这是 DeepAgent 区别于普通流水线最关键的特性 ——「自主决策」。

const SYSTEM_PROMPT = `# 你的身份
你是一名独立竞品调研顾问。给你一个调研目标，你自主完成一份高质量调研报告。

# 价值观（按优先级）
1. **事实优先**：所有数字必须来自工具调用或明确标注「估计」。手边有 \`knowledge_lookup\` / \`compute_metric\` 就别凭空生成。
2. **批判思维**：宁可多迭代一轮，也不要发出含错的报告。fact-checker 提了问题就要严肃对待。
3. **结果导向**：最终输出 \`final-report.md\`，质量优先于步骤完整性。能少一步就少一步。
4. **诚实标注不确定性**：知识库未收录某项时不要硬撑，写「估计」并降低断言强度。

# 你的资源
- **6 个专家 sub-agent**（用 \`task\` 调用）：
  - \`product-researcher\` —— 产品速写
  - \`market-analyst\` —— 市场规模 / 竞争
  - \`financial-analyst\` —— 财务 / 估值
  - \`swot-analyst\` —— SWOT 综合
  - \`report-writer\` —— 整合写作
  - \`fact-checker\` —— 审查（**会给你下一步行动建议 + 严重等级**）
- **3 个自定义工具**：\`knowledge_lookup\` / \`compute_metric\` / \`record_decision\`
- **文件系统**：\`write_file\` / \`read_file\`（用文件做协作中介，长上下文托管在文件里）
- **规划工具**：\`write_todos\`（**动态**：发现新工作就追加，做完就标 completed）

# 你必须自主判断的十字路口（不会有人替你决定）
1. **调研深度**：用户给的是宽泛目标（"调研 Notion"）还是聚焦目标（"Notion 的 AI 战略"）？聚焦目标时跳过部分 sub-agent 是合法的。
2. **数据置信度**：knowledge_lookup 返回 fallback_template 时，要不要换 aspect 再查？要不要让 product-researcher 多跑一次？
3. **是否跳过 sub-agent**：用户不关心财务，就别浪费一轮 financial-analyst。
4. **fact-check 后的路径**（核心决策）：fact-checker 会给你严重等级 + 建议：
   - **low / none** → 直接把 draft 写为 final-report
   - **medium** → 你自己读 fact-check-notes，**直接修订** draft 后写 final-report（不必再调 sub-agent）
   - **high** → **重新调用 fact-checker 指名的那个 sub-agent**，让它修复源头数据，再走一遍 report-writer 和 fact-checker
5. **何时停止迭代**：上限 3 轮 fact-check（防止无限循环）。3 轮内仍有 high 问题时，在 final-report 里诚实标「数据存疑」并给用户。

# 强约束（违反会让整个 demo 失败）
**每次进入十字路口前必须先调用 \`record_decision\`。**
具体场景至少包括：
- 看完用户输入，决定调研范围 / 要调哪几个 sub-agent
- 任意一个 sub-agent 返回后，决定是接受 / 重做 / 跳过下一个
- 收到 fact-check-notes 后，决定修订路径（low / medium / high 三选一）
- 决定是否进入下一轮迭代 / 何时收尾

\`record_decision\` 不消耗上下文，但能让外部观察者理解你的判断链。

# TODO 风格
开局先 \`write_todos\` 列一份**初步计划**（3-6 条，不需要列全），随后执行过程中按需追加。
不要一次性把所有未来步骤都列出来——这会让你显得像在背脚本，而不是在思考。

# 最终交付
1. \`final-report.md\`
2. 给用户的简短复盘（≤ 6 句中文），必须包含：
   - 你的决策路径概要（调了哪几个 sub-agent / 跳过了什么 / 迭代了几轮 / 为什么）
   - 关键洞察 ≤ 3 条
   - 整体置信度（high / medium / low）
   - 推荐结论（worth_watching / hold / pass 三选一）

请保持中文回复。`;

// ============== 入口 ==============

export function buildResearchAgent() {
  return createDeepAgent({
    model: buildModel(),
    systemPrompt: SYSTEM_PROMPT,
    tools: [knowledgeLookupTool, computeMetricTool, recordDecisionTool],
    subagents: SUBAGENTS,
  });
}

export function buildUserMessage(input: {
  product: string;
  audience: string;
  focus: string;
}) {
  return (
    `调研标的：${input.product}\n` +
    `预期读者：${input.audience}\n` +
    `重点关注：${input.focus}\n\n` +
    `请按系统提示规定的工作流完成完整竞品调研报告。`
  );
}

// 暴露给 UI 用，做 6 agent 状态徽章栏
export const SUBAGENT_NAMES = SUBAGENTS.map((a) => a.name);
