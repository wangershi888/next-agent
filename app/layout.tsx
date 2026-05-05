import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import "@ant-design/v5-patch-for-react-19";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Frameworks Demo · LangChain / LangGraph / DeepAgent",
  description:
    "三个对比 demo：LangChain LCEL、LangGraph 反思图、DeepAgent 多智能体规划",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>{children}</AntdRegistry>
      </body>
    </html>
  );
}
