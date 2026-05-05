/**
 * DeepAgent demo —— "多智能体旅行规划师"。
 *
 * 突出特性（DeepAgent 的"四件套"）：
 *   1. 规划工具：内置 `write_todos`，主 Agent 会先把任务拆成 TODO 再动手。
 *   2. 子 Agent：`task` 工具把"景点 / 美食 / 交通"分别交给三个专属子 Agent，
 *      避免上下文污染。
 *   3. 文件系统：内置 `write_file`，最终把整理好的方案写到 `trip-plan.md`。
 *   4. 详细系统提示：通过 systemPrompt 强约束工作流。
 */
import { ChatDeepSeek } from "@langchain/deepseek";
import { createDeepAgent, type SubAgent } from "deepagents";

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
    // DeepAgent 框架内部依赖 tool calling 走多步流程，部分场景会强制 tool_choice，
    // 而 DeepSeek V4 的 thinking 模式不支持强制 tool_choice，这里显式关闭。
    modelKwargs: { thinking: { type: "disabled" } },
  });
}

const attractionsExpert: SubAgent = {
  name: "attractions-expert",
  description:
    "景点专家。当需要确定目的地必去景点（含亮点说明、推荐游玩时长）时调用。" +
    "调用方式：在 description 里写清楚『目的地 + 用户偏好 + 天数预算』。",
  systemPrompt:
    "你是当地资深旅行向导。请围绕用户给出的目的地和偏好，列出 3-5 个最值得一看的景点。" +
    "每个景点用 1-2 句话说明亮点 + 建议游玩时长。直接以 Markdown 列表回复，不要寒暄。",
};

const cuisineExpert: SubAgent = {
  name: "cuisine-expert",
  description:
    "美食专家。当需要确定目的地必吃美食 / 餐厅特色时调用。" +
    "调用方式：description 里说明『目的地 + 用户口味 / 忌口 + 预算档次』。",
  systemPrompt:
    "你是当地美食博主。请给出 3-5 道必吃菜品 + 1-2 家有代表性的餐厅风格描述。" +
    "用 Markdown 列表回复，每条 1 句话即可，不要寒暄。",
};

const logisticsExpert: SubAgent = {
  name: "logistics-expert",
  description:
    "出行 / 住宿专家。当需要确定交通方式、住宿区域、注意事项时调用。" +
    "调用方式：description 里说明『目的地 + 出发城市（若有）+ 天数 + 预算档次』。",
  systemPrompt:
    "你是经验丰富的旅行规划师。请给出：(1) 推荐的城际交通方式 (2) 推荐的住宿区域并说明理由 " +
    "(3) 1-2 条容易被忽视的实用提醒。Markdown 列表，简洁直接。",
};

const SYSTEM_PROMPT = `你是一位顶级旅行规划主管。你的工作流必须严格遵守：

第一步：使用 \`write_todos\` 写出 4 条 TODO，分别是：
  1) 调用 attractions-expert 收集景点
  2) 调用 cuisine-expert 收集美食
  3) 调用 logistics-expert 收集交通住宿
  4) 把以上信息整合成最终行程并写入 trip-plan.md

第二步：依次调用 \`task\` 工具并 subagent_type 分别为 attractions-expert / cuisine-expert / logistics-expert。
        每完成一项，立刻用 \`write_todos\` 把对应 TODO 标记为 completed，并把下一项标记为 in_progress。

第三步：根据三位子 Agent 的回复，撰写一份结构清晰的 Markdown 行程方案，
        然后用 \`write_file\` 写入路径 \`trip-plan.md\`。最终方案至少包含：
        - 标题：「<目的地> <天数> 日深度游」
        - 「行程高亮」区块
        - 「每日行程」表格（按天列出）
        - 「美食推荐」「住宿与交通」两个区块

第四步：用一段简短的中文给用户复述：「方案已写入 trip-plan.md，含哪些核心模块」。
不要重复输出文件全文。

请保持中文回复，所有工具调用都按以上工作流推进，不要跳步。`;

export function buildTravelAgent() {
  return createDeepAgent({
    model: buildModel(),
    systemPrompt: SYSTEM_PROMPT,
    subagents: [attractionsExpert, cuisineExpert, logisticsExpert],
  });
}

export function buildUserMessage(input: {
  destination: string;
  days: number;
  preference: string;
  budget: string;
}) {
  return (
    `目的地：${input.destination}\n` +
    `天数：${input.days}\n` +
    `出行偏好：${input.preference}\n` +
    `预算档次：${input.budget}\n\n` +
    `请按系统提示规定的四步法，规划一份行程方案。`
  );
}
