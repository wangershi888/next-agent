"use client";

import { useCallback, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Card,
  Flex,
  Input,
  Layout,
  Space,
  Typography,
  theme,
} from "antd";

const { Text, Paragraph } = Typography;

type StepRecord = {
  key: string;
  title?: string;
  payload?: Record<string, unknown>;
};

export function TradingDecisionTab() {
  const { token } = theme.useToken();
  const [code, setCode] = useState("600519");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepRecord[]>([]);
  const [meta, setMeta] = useState<string | null>(null);

  const run = useCallback(async () => {
    const raw = code.trim();
    if (!raw || loading) return;

    setLoading(true);
    setError(null);
    setSteps([]);
    setMeta(null);

    try {
      const res = await fetch("/api/agents/trading-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockCode: raw }),
      });

      if (!res.ok || !res.body) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          let evt: {
            type?: string;
            key?: string;
            title?: string;
            message?: string;
            payload?: Record<string, unknown>;
          };
          try {
            evt = JSON.parse(jsonStr) as typeof evt;
          } catch {
            continue;
          }

          if (evt.type === "step") {
            const stepKey = evt.key;
            if (typeof stepKey === "string" && stepKey.length > 0) {
              setSteps((prev) => [
                ...prev,
                {
                  key: stepKey,
                  title: evt.title,
                  payload: evt.payload,
                },
              ]);
            }
          } else if (evt.type === "result") {
            const pl = evt.payload;
            setSteps((prev) => [
              ...prev,
              {
                key: "pipeline_result",
                title: evt.title ?? "合并状态",
                payload:
                  pl && typeof pl === "object" ? (pl as Record<string, unknown>) : {},
              },
            ]);
          } else if (evt.type === "meta" && evt.message) {
            setMeta(evt.message);
          } else if (evt.type === "error") {
            throw new Error(evt.message ?? "执行出错");
          }
        }
      }
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e);
      if (/fetch failed|Failed to fetch|NetworkError|Load failed/i.test(msg)) {
        msg +=
          "。若为浏览器直连开发服务器：请确认本地终端里的 Next.js 仍在运行；若在受限网络环境，请检查代理/VPN。";
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [code, loading]);

  return (
    <Layout
      style={{
        height: "calc(100vh - 140px)",
        minHeight: 420,
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        overflow: "hidden",
      }}
    >
      <Flex vertical style={{ height: "100%", background: "var(--chat-bg)" }}>
        <Flex
          justify="space-between"
          align="flex-start"
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--chat-border)",
            background: "var(--chat-surface)",
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text strong>多 Agent 交易决策</Text>
            <Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 6, fontSize: 13 }}>
              后端 Chain 单文件：
              <Text code>frameworks/langchain/chains/trading-decision-chain.ts</Text>
              （RunnableLambda / RunnableSequence / pipe）。流水线：normalize → 数据分析师 → 技术分析师 →
              风控 → 交易摘要。
            </Paragraph>
          </div>
          <Space wrap>
            <Input
              style={{ width: 140 }}
              placeholder="股票代码"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={loading}
              maxLength={12}
            />
            <Button type="primary" loading={loading} onClick={() => void run()}>
              运行链路
            </Button>
          </Space>
        </Flex>

        {error ? (
          <div style={{ padding: 12 }}>
            <Alert type="error" message={error} showIcon />
          </div>
        ) : null}

        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: 16,
          }}
        >
          {steps.length === 0 && !loading ? (
            <Flex justify="center" align="center" style={{ minHeight: 160 }}>
              <Text type="secondary">输入沪深 A 股代码后点击「运行链路」，查看各节点工具输出与 Agent 输出。</Text>
            </Flex>
          ) : (
            <Flex vertical gap={12}>
              {steps.map((s, i) => (
                <Card
                  key={`${s.key}-${i}`}
                  size="small"
                  title={
                    <span>
                      <Text code>{s.key}</Text>
                      {s.title ? (
                        <Text type="secondary" style={{ marginLeft: 8, fontSize: 13 }}>
                          {s.title}
                        </Text>
                      ) : null}
                    </span>
                  }
                >
                  <StepPayloadView payload={s.payload} />
                </Card>
              ))}
              {loading ? (
                <Text type="secondary">
                  <Text strong>运行中…</Text>
                </Text>
              ) : null}
              {meta ? (
                <Alert type="info" message={meta} showIcon style={{ marginTop: 8 }} />
              ) : null}
            </Flex>
          )}
        </div>
      </Flex>
    </Layout>
  );
}

function StepPayloadView({ payload }: { payload?: Record<string, unknown> }) {
  if (!payload || typeof payload !== "object") {
    return <Text type="secondary">（无载荷）</Text>;
  }

  const blocks: ReactNode[] = [];

  if (typeof payload.toolName === "string") {
    blocks.push(
      <div key="toolName">
        <Text strong>工具名：</Text> <Text code>{payload.toolName}</Text>
      </div>,
    );
  }

  if (typeof payload.toolOutput === "string" && payload.toolOutput) {
    blocks.push(
      <pre
        key="toolOut"
        style={{
          marginTop: 8,
          padding: 10,
          borderRadius: 8,
          background: "var(--chat-assistant)",
          border: "1px solid var(--chat-border)",
          fontSize: 12,
          maxHeight: 220,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        <Text strong style={{ display: "block", marginBottom: 6 }}>
          工具原始输出
        </Text>
        {payload.toolOutput}
      </pre>,
    );
  }

  if (typeof payload.nodeOutput === "string" && payload.nodeOutput) {
    blocks.push(
      <div key="nodeOut" style={{ marginTop: 10 }}>
        <Text strong>节点（Agent）输出</Text>
        <Paragraph style={{ marginTop: 6, marginBottom: 0, whiteSpace: "pre-wrap" }}>
          {payload.nodeOutput}
        </Paragraph>
      </div>,
    );
  }

  if (payload.stockCode != null || payload.secid != null) {
    blocks.push(
      <div key="norm" style={{ marginTop: 4 }}>
        {payload.stockCode != null ? (
          <div>
            <Text strong>代码：</Text> {String(payload.stockCode)}
          </div>
        ) : null}
        {payload.secid != null ? (
          <div>
            <Text strong>东方财富 secid：</Text> <Text code>{String(payload.secid)}</Text>
          </div>
        ) : null}
      </div>,
    );
  }

  if (blocks.length === 0) {
    const summaryKeys = [
      "newsToolOutput",
      "marketToolOutput",
      "dataAnalyst",
      "technicalAnalyst",
      "riskControl",
      "tradingAgent",
    ];
    const lines: ReactNode[] = [];
    for (const k of summaryKeys) {
      const v = payload[k];
      if (typeof v === "string" && v) {
        lines.push(
          <div key={k} style={{ marginBottom: 12 }}>
            <Text strong>{k}</Text>
            <Paragraph style={{ marginTop: 4, marginBottom: 0, whiteSpace: "pre-wrap" }}>
              {v}
            </Paragraph>
          </div>,
        );
      }
    }
    if (lines.length > 0) return <>{lines}</>;

    return (
      <pre
        style={{
          margin: 0,
          fontSize: 12,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {JSON.stringify(payload, null, 2)}
      </pre>
    );
  }

  return <>{blocks}</>;
}
