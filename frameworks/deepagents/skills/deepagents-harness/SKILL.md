---
name: deepagents-harness
description: 指导如何发挥 Deep Agents 的规划、虚拟文件系统、子智能体与 Skills 渐进加载能力。
---

# Deep Agents 能力要领

## 规划（write_todos）
- 任务含多步推理、检索、长文输出时，先写待办并随进度更新状态（pending / in_progress / completed）。
- 待办条目用简短中文，便于用户在界面时间线中理解。

## 虚拟文件系统
- 长素材、摘录、中间结论写入 `/workspace/` 下路径（如 `/workspace/notes/clip.md`）。
- 需要引用时再 `read_file` / `grep`，避免一次性塞进模型上下文。

## 子智能体（task）
- 需要「专门检索 + 归纳」时，委派给 `research-subagent`（若已启用联网）。
- 向子任务描述清楚目标、输出格式与停止条件。

## Skills
- 本仓库在 `frameworks/deepagents/skills/<slug>/SKILL.md` 新增即会自动注入虚拟 `/skills/`，无需改 TypeScript 注册表。
- 仅当用户问题涉及本仓库架构时，加载 `next-agent-architecture`（`/skills/next-agent-architecture/`）。
- 外出、天气、穿衣、限行、空气质量 → `outing-advice`（`/skills/outing-advice/`）。
- 提示词、角色设定、Few-shot、输出格式调优 → `prompt-engineering`。
- 知识库问答、向量检索、chunk、重排、引用与 RAG 评测 → `rag-qa`。
- 接口鉴权、注入、密钥、CORS、上线前安全清单 → `api-security-basics`。
- PR / Code Review、可读性、边界条件、测试建议 → `code-review`。
- 张雪峰视角、高考/考研志愿、就业向务实分析 → `zhangxuefeng-perspective`（来源：https://github.com/duomi-young/duomi-zhangxuefeng-skill ）。
- 回答通用 Deep Agents 用法时，仍遵循本 skill 的规划/文件/子智能体原则。
