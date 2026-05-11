import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /** 确保 standalone / 部署追踪包含磁盘上的 SKILL.md（deep-chat 运行时 readFileSync） */
  outputFileTracingIncludes: {
    "/api/agents/deep-chat": ["./.agents/skills/**/*"],
  },
};

export default nextConfig;
