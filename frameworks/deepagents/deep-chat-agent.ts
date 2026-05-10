import { createDeepAgent, type SubAgent } from "deepagents";
import { createQwenChatModel } from "@/frameworks/langchain/model/chat-models";
import { createTavilyWebSearchTool } from "@/frameworks/langchain/tools/web-search";
import { deepChatCheckpointer } from "./deep-chat-checkpointer";

export interface NextDeepChatAgentOptions {
  enableWebSearch: boolean;
}

const DEEP_CHAT_SYSTEM_ZH = `你是专业、克制、偏技术风格的对话助手，交互体验参考 DeepSeek 官网：先理解意图，再分步执行，最后给出清晰结论。

请使用简体中文撰写对用户可见的回复；代码、路径、URL、工具原始输出可保留原样。

你必须充分利用 Deep Agents 内置能力：
- 用 write_todos 做显式规划，并在步骤变化时更新待办状态。
- 用虚拟文件系统（read_file / write_file / edit_file / ls / glob / grep）管理长上下文与笔记，大段材料优先落盘到 /workspace/ 再引用。
- 在适合并行或需要隔离上下文的子任务上使用 task 工具委派子智能体（例如深度检索与归纳）。
- 在涉及本仓库结构、Tab、API 路径等问题时，先按 Skills 指引加载对应 SKILL.md 再回答。`;

export function createNextDeepChatAgent(options: NextDeepChatAgentOptions) {
  const model = createQwenChatModel({ streaming: true });
  const tavilyKey = process.env.TAVILY_API_KEY;

  const webTools =
    options.enableWebSearch && tavilyKey ? [createTavilyWebSearchTool(tavilyKey)] : [];

  const subagents: SubAgent[] = [];
  if (webTools.length > 0) {
    subagents.push({
      name: "research-subagent",
      description:
        "用于「多轮检索 + 归纳」的子任务。父级 Agent 应给出明确问题与期望输出结构；子智能体使用 web_search 与虚拟文件完成草稿，再返回精炼中文要点。",
      systemPrompt:
        "你是检索与摘录专员。优先用 web_search 获取事实；需要时可把长摘录写入 /workspace/notes/ 下文件。最终用有条理的中文要点回复父 Agent，避免空话。",
      tools: webTools,
    });
  }

  const agent = createDeepAgent({
    model,
    tools: webTools,
    subagents,
    skills: ["/skills/"],
    systemPrompt: DEEP_CHAT_SYSTEM_ZH,
    checkpointer: deepChatCheckpointer,
    name: "next-deep-chat",
  });

  return { agent };
}
