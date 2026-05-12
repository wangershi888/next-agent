/**
 * 项目内 MCP（stdio → LangChain Tool）统一入口，与 `tools/*.ts` 并列维护。
 */
export {
  type DeepChatMcpHandle,
  loadDeepChatMcpTools,
} from "./deep-chat-official";
export {
  type ServerPuppeteerMcpHandle,
  loadServerPuppeteerMcpTools,
  resolveServerPuppeteerMcpEntry,
} from "./puppeteer-browser";
export { mcpStringProcessEnv, resolveMcpServerEntry } from "./resolve";
