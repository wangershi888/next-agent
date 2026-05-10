import { MemorySaver } from "@langchain/langgraph";

/**
 * 与 Argument Assistant 相同思路：单例 MemorySaver，客户端用 thread_id 区分会话。
 */
export const deepChatCheckpointer = new MemorySaver();
