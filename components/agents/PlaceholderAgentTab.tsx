"use client";

import { Empty, Typography } from "antd";

export function PlaceholderAgentTab(props: { title: string; description: string }) {
  return (
    <div style={{ padding: 48, maxWidth: 560 }}>
      <Typography.Title level={4}>{props.title}</Typography.Title>
      <Typography.Paragraph type="secondary">{props.description}</Typography.Paragraph>
      <Empty description="敬请期待" />
    </div>
  );
}
