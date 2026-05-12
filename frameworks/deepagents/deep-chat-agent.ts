import {
  CompositeBackend,
  createDeepAgent,
  FilesystemBackend,
  StateBackend,
  type SubAgent,
} from "deepagents";
import { createQwenChatModel } from "@/frameworks/langchain/model/chat-models";
import { createTavilyWebSearchTool } from "@/tools/web-search";
import { BUNDLED_SKILLS_DISK_ROOT } from "./bundled-skills";
import { deepChatCheckpointer } from "./deep-chat-checkpointer";
import { loadDeepChatMcpTools } from "@/tools/mcp/deep-chat-official";

export interface NextDeepChatAgentOptions {
  enableWebSearch: boolean;
}

const DEEP_CHAT_SYSTEM_ZH = `你是专业、克制、偏技术风格的对话助手，交互体验参考 DeepSeek 官网：先理解意图，再分步执行，最后给出清晰结论。

请使用简体中文撰写对用户可见的回复；代码、路径、URL、工具原始输出可保留原样。

你必须充分利用 Deep Agents 内置能力：
- 用 write_todos 做显式规划，并在步骤变化时更新待办状态。
- 用虚拟文件系统（read_file / write_file / edit_file / ls / glob / grep）管理长上下文与笔记，大段材料优先落盘到 /workspace/ 再引用。
- 新增或更新本仓库内 Agent Skill 时，写入虚拟路径 /skills/（对应磁盘目录 .agents/skills/，例：/skills/foo-perspective/SKILL.md）。
- 在适合并行或需要隔离上下文的子任务上使用 task 工具委派子智能体（例如深度检索与归纳）。
- 在涉及本仓库结构、Tab、API 路径等问题时，先按 Skills 指引加载对应 SKILL.md 再回答。
- 若已加载 MCP：memory_*（知识图谱记忆）、sequential_thinking_*（分步推理）、host_filesystem_*（宿主机项目根目录内真实文件，与虚拟 /workspace、/skills 区分）。`;

export async function createNextDeepChatAgent(options: NextDeepChatAgentOptions) {
  const model = createQwenChatModel({ streaming: true });
  const tavilyKey = process.env.TAVILY_API_KEY;

  const webTools =
    options.enableWebSearch && tavilyKey ? [createTavilyWebSearchTool(tavilyKey)] : [];

  const mcpHandle = await loadDeepChatMcpTools();
  const mcpTools = mcpHandle?.tools ?? [];

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

  try {
    const agent = createDeepAgent({
      model,
      tools: [...mcpTools, ...webTools],
      subagents,
      skills: ["/skills/"],
      /**
       * `/skills/` 映射到仓库 `.agents/skills/`：可读可写，便于在对话中新增/更新 Skill（如女娲蒸馏产物）。
       * 其余虚拟路径仍在 StateBackend，避免整盘暴露。
       */
      backend: (config) =>
        new CompositeBackend(new StateBackend(config), {
          "/skills/": new FilesystemBackend({
            rootDir: BUNDLED_SKILLS_DISK_ROOT,
            virtualMode: true,
          }),
        }),
      systemPrompt: DEEP_CHAT_SYSTEM_ZH,
      checkpointer: deepChatCheckpointer,
      name: "next-deep-chat",
    });

    return {
      agent,
      dispose: async () => {
        await mcpHandle?.close();
      },
    };
  } catch (e) {
    await mcpHandle?.close().catch(() => {});
    throw e;
  }
}
