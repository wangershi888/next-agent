import path from "node:path";

/**
 * 与官方 `npx skills add … -a deepagents` 一致的项目目录：`.agents/skills/`。
 * Deep Agents 通过 `CompositeBackend` 将其挂载为虚拟路径 `/skills/`。
 */
export const BUNDLED_SKILLS_DISK_ROOT = path.join(process.cwd(), ".agents/skills");
