/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    "@langchain/core",
    "@langchain/deepseek",
    "@langchain/langgraph",
    "deepagents",
    "langchain",
  ],
};

export default nextConfig;
