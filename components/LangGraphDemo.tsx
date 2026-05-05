"use client";

import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  InputNumber,
  Progress,
  Row,
  Space,
  Spin,
  Steps,
  Tag,
  Typography,
  message,
} from "antd";
import {
  LoadingOutlined,
  PlayCircleOutlined,
  RightOutlined,
} from "@ant-design/icons";

const { Title, Paragraph, Text } = Typography;

type Critique = { score: number; feedback: string };
type IterationLog = {
  iteration: number;
  draft?: string;
  critique?: Critique;
};

type RouteEvent =
  | { type: "start"; topic: string; maxIterations: number; targetScore: number }
  | { type: "node"; node: string; payload: any }
  | { type: "end" }
  | { type: "error"; error: string };

const PRESETS = ["量子纠缠", "Transformer 注意力机制", "为什么天空是蓝色的"];

export default function LangGraphDemo() {
  const [topic, setTopic] = useState(PRESETS[0]);
  const [maxIterations, setMaxIterations] = useState(3);
  const [targetScore, setTargetScore] = useState(8);
  const [running, setRunning] = useState(false);
  const [iterations, setIterations] = useState<IterationLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  function reset() {
    setIterations([]);
    setError(null);
    setDone(false);
  }

  function applyEvent(ev: RouteEvent) {
    if (ev.type === "node") {
      const { node, payload } = ev;
      if (node === "generate") {
        const newDraft: string = (payload?.drafts ?? []).slice(-1)[0] ?? "";
        const iterNum: number = payload?.iteration ?? 0;
        setIterations((prev) => [
          ...prev,
          { iteration: iterNum, draft: newDraft },
        ]);
      } else if (node === "critique") {
        const c: Critique | undefined = (payload?.critiques ?? []).slice(-1)[0];
        if (c) {
          setIterations((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last) last.critique = c;
            return copy;
          });
        }
      }
    } else if (ev.type === "end") {
      setDone(true);
    } else if (ev.type === "error") {
      setError(ev.error);
    }
  }

  async function run() {
    reset();
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const resp = await fetch("/api/langgraph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, maxIterations, targetScore }),
        signal: controller.signal,
      });

      if (!resp.body) throw new Error("No response body");
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done: rdrDone } = await reader.read();
        if (rdrDone) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const chunk of parts) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          try {
            const ev: RouteEvent = JSON.parse(json);
            applyEvent(ev);
          } catch {
            // ignore parse error
          }
        }
      }
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      const m = err instanceof Error ? err.message : "请求失败";
      setError(m);
      message.error(m);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
  }

  const lastIter = iterations[iterations.length - 1];
  const finalScore = lastIter?.critique?.score ?? 0;

  return (
    <div className="demo-card">
      <Title level={4} style={{ marginTop: 0 }}>
        反思式短文生成器 · StateGraph + 条件边
      </Title>
      <Paragraph type="secondary" style={{ marginTop: -4 }}>
        模型先写草稿，编辑给出评分和建议，
        <Text strong>分数不达标就回到 generate 节点继续改</Text>
        ，直到达标或用完次数。 这是 LangGraph 最经典的「Reflection」范式，凸显
        <Text code>条件边形成循环</Text>
        这一关键能力。
      </Paragraph>

      <div className="flow-pipeline" style={{ marginBottom: 16 }}>
        <Tag>START</Tag>
        <RightOutlined className="flow-arrow" />
        <Tag color="blue">generate</Tag>
        <RightOutlined className="flow-arrow" />
        <Tag color="purple">critique</Tag>
        <RightOutlined className="flow-arrow" />
        <Tag color="orange">decide (条件边)</Tag>
        <RightOutlined className="flow-arrow" />
        <Tag>END</Tag>
        <Text type="secondary" style={{ marginLeft: 12 }}>
          decide 不达标会回到 generate ⤴
        </Text>
      </div>

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={12}>
          <Text>主题</Text>
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="例如：量子纠缠"
            style={{ marginTop: 4 }}
          />
        </Col>
        <Col xs={12} md={6}>
          <Text>最大迭代次数</Text>
          <InputNumber
            min={1}
            max={5}
            value={maxIterations}
            onChange={(v) => setMaxIterations(Number(v) || 1)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </Col>
        <Col xs={12} md={6}>
          <Text>目标分数 (1-10)</Text>
          <InputNumber
            min={1}
            max={10}
            value={targetScore}
            onChange={(v) => setTargetScore(Number(v) || 8)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </Col>
      </Row>

      <Space wrap style={{ marginBottom: 16 }}>
        {PRESETS.map((p) => (
          <Tag
            key={p}
            color="blue"
            style={{ cursor: "pointer" }}
            onClick={() => setTopic(p)}
          >
            {p}
          </Tag>
        ))}
        {!running ? (
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={run}
            disabled={!topic.trim()}
          >
            运行 Graph
          </Button>
        ) : (
          <Button danger icon={<LoadingOutlined />} onClick={stop}>
            运行中 · 点击中止
          </Button>
        )}
      </Space>

      {error && (
        <Alert type="error" showIcon message={error} style={{ marginTop: 8 }} />
      )}

      {running && iterations.length === 0 && (
        <Card
          size="small"
          style={{
            marginTop: 8,
            background: "#fafafa",
            borderStyle: "dashed",
          }}
        >
          <Spin
            indicator={<LoadingOutlined spin />}
            tip="正在唤醒 LangGraph，等待 generate 节点输出第一稿…"
          >
            <div style={{ height: 48 }} />
          </Spin>
        </Card>
      )}

      {iterations.length > 0 && (
        <>
          <Steps
            current={iterations.length - (done ? 0 : 1)}
            size="small"
            style={{ marginBottom: 16 }}
            items={iterations.map((it) => ({
              title: `第 ${it.iteration} 轮`,
              description: it.critique
                ? `评分 ${it.critique.score}`
                : "writing...",
              status: it.critique
                ? it.critique.score >= targetScore
                  ? "finish"
                  : "process"
                : "process",
            }))}
          />
          <Row gutter={[16, 16]}>
            {iterations.map((it) => (
              <Col xs={24} md={12} key={it.iteration}>
                <Card
                  size="small"
                  title={
                    <Space>
                      <Tag color="blue">迭代 {it.iteration}</Tag>
                      {it.critique && (
                        <Tag
                          color={
                            it.critique.score >= targetScore ? "green" : "gold"
                          }
                        >
                          评分 {it.critique.score}/10
                        </Tag>
                      )}
                    </Space>
                  }
                >
                  <Paragraph
                    style={{ whiteSpace: "pre-wrap", marginBottom: 12 }}
                  >
                    {it.draft || (
                      <Space>
                        <LoadingOutlined spin />
                        <Text type="secondary">generate 节点写作中…</Text>
                      </Space>
                    )}
                  </Paragraph>
                  {it.critique ? (
                    <Alert
                      type={
                        it.critique.score >= targetScore ? "success" : "warning"
                      }
                      showIcon
                      message={
                        <Space>
                          编辑反馈
                          <Progress
                            percent={it.critique.score * 10}
                            size="small"
                            style={{ width: 120 }}
                            showInfo={false}
                          />
                        </Space>
                      }
                      description={it.critique.feedback}
                    />
                  ) : (
                    <Space>
                      <LoadingOutlined spin />
                      <Text type="secondary">critique 节点点评中…</Text>
                    </Space>
                  )}
                </Card>
              </Col>
            ))}
          </Row>
          {done && (
            <Alert
              style={{ marginTop: 16 }}
              type={finalScore >= targetScore ? "success" : "info"}
              showIcon
              message={
                finalScore >= targetScore
                  ? `🎯 达标！终稿评分 ${finalScore}/10`
                  : `⏱️ 已用完 ${iterations.length} 轮迭代，终稿评分 ${finalScore}/10`
              }
            />
          )}
        </>
      )}
    </div>
  );
}
