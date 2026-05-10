"use client";

import { Layout, Tabs, Typography } from "antd";
import { agentTabs } from "@/lib/agents/tab-registry";

const { Header, Content } = Layout;

export default function HomePage() {
  return (
    <Layout style={{ minHeight: "100vh", background: "var(--chat-bg)" }}>
      <Header
        style={{
          background: "var(--chat-surface)",
          borderBottom: "1px solid var(--chat-border)",
          paddingInline: 24,
          height: 56,
          lineHeight: "56px",
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          Agent Demos
        </Typography.Title>
      </Header>
      <Content style={{ padding: 16 }}>
        <Tabs
          destroyInactiveTabPane
          items={agentTabs.map((t) => ({
            key: t.key,
            label: t.label,
            children: t.children,
          }))}
        />
      </Content>
    </Layout>
  );
}
