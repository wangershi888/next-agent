"use client";

import { useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Input,
  InputNumber,
  Progress,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
  message,
} from "antd";
import {
  CrownTwoTone,
  FireOutlined,
  LoadingOutlined,
  PlayCircleOutlined,
  RightOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";

const { Title, Paragraph, Text } = Typography;
const { TextArea } = Input;

type Tone = "calm" | "fierce" | "sarcastic" | "passionate";

type DebateTurn = {
  side: "red" | "blue";
  round: number;
  rebuttal: string;
  points: string[];
  emotional_tone: Tone;
};

type DebateJudgment = {
  round: number;
  redScore: number;
  blueScore: number;
  comment: string;
};

type DebateVerdict = {
  winner: "red" | "blue" | "draw";
  finalRedScore: number;
  finalBlueScore: number;
  commentary: string;
};

type RouteEvent =
  | {
      type: "start";
      topic: string;
      redStance: string;
      blueStance: string;
      maxRounds: number;
    }
  | { type: "node"; node: string; payload: any }
  | { type: "end" }
  | { type: "error"; error: string };

const PRESETS = [
  {
    label: "AI 是否会让程序员失业？",
    topic: "AI 是否会让大部分初中级程序员在 5 年内失业？",
    red: "5 年内 AI 会替代大部分初中级程序员的日常 coding 工作",
    blue: "AI 只是工具，初中级程序员依然不可替代",
  },
  {
    label: "远程办公 vs 回办公室",
    topic: "公司应不应该强制员工每周 5 天到岗？",
    red: "全员每周 5 天到岗，能让协作效率最大化",
    blue: "强制 5 天到岗弊大于利，应保留至少 2 天远程",
  },
  {
    label: "通用 AI vs 垂直 AI",
    topic: "未来 5 年是通用大模型赢，还是垂直行业小模型赢？",
    red: "通用大模型会一统江湖，垂直小模型只是过渡",
    blue: "垂直小模型会在大量行业把通用模型按在地上摩擦",
  },
];

export default function LangGraphDemo() {
  const [topic, setTopic] = useState(PRESETS[0].topic);
  const [redStance, setRedStance] = useState(PRESETS[0].red);
  const [blueStance, setBlueStance] = useState(PRESETS[0].blue);
  const [maxRounds, setMaxRounds] = useState(3);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [currentNode, setCurrentNode] = useState<string | null>(null);

  const [redTurns, setRedTurns] = useState<DebateTurn[]>([]);
  const [blueTurns, setBlueTurns] = useState<DebateTurn[]>([]);
  const [judgments, setJudgments] = useState<DebateJudgment[]>([]);
  const [verdict, setVerdict] = useState<DebateVerdict | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  function reset() {
    setError(null);
    setDone(false);
    setCurrentNode(null);
    setRedTurns([]);
    setBlueTurns([]);
    setJudgments([]);
    setVerdict(null);
  }

  function applyEvent(ev: RouteEvent) {
    if (ev.type === "node") {
      setCurrentNode(ev.node);
      const p = ev.payload ?? {};
      if (Array.isArray(p.redTurns) && p.redTurns.length > 0) {
        setRedTurns((prev) => [...prev, ...p.redTurns]);
      }
      if (Array.isArray(p.blueTurns) && p.blueTurns.length > 0) {
        setBlueTurns((prev) => [...prev, ...p.blueTurns]);
      }
      if (Array.isArray(p.judgments) && p.judgments.length > 0) {
        setJudgments((prev) => [...prev, ...p.judgments]);
      }
      if (p.verdict) setVerdict(p.verdict);
    } else if (ev.type === "end") {
      setDone(true);
      setCurrentNode(null);
    } else if (ev.type === "error") {
      setError(ev.error);
      setCurrentNode(null);
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
        body: JSON.stringify({ topic, redStance, blueStance, maxRounds }),
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
            applyEvent(JSON.parse(json));
          } catch {}
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

  // 把红蓝双方按 round 配成一行一行的「对决」
  const rounds = Array.from(
    { length: Math.max(redTurns.length, blueTurns.length) },
    (_, i) => i + 1,
  ).map((round) => ({
    round,
    red: redTurns.find((t) => t.round === round),
    blue: blueTurns.find((t) => t.round === round),
    judgment: judgments.find((j) => j.round === round),
  }));

  const totalRed = judgments.reduce((s, j) => s + j.redScore, 0);
  const totalBlue = judgments.reduce((s, j) => s + j.blueScore, 0);

  return (
    <div className="demo-card">
      <Title level={4} style={{ marginTop: 0 }}>
        红蓝队辩论赛 · StateGraph + 双 Agent + 条件边
      </Title>
      <Paragraph type="secondary" style={{ marginTop: -4 }}>
        红蓝双方各自维护独立论点链，<Text strong>每一轮必须先反驳对方再立论</Text>
        ，judge 节点逐轮打分，<Text code>条件边</Text>{" "}
        在「轮次未满 → red_argue」和「已满 → verdict」间路由。
        因为两个 agent 在「咬」对方上一轮的具体论点，每轮内容会真正发散。
      </Paragraph>

      <div className="flow-pipeline" style={{ marginBottom: 16 }}>
        <Tag>START</Tag>
        <RightOutlined className="flow-arrow" />
        <Tag color="red">red_argue</Tag>
        <RightOutlined className="flow-arrow" />
        <Tag color="blue">blue_argue</Tag>
        <RightOutlined className="flow-arrow" />
        <Tag color="purple">judge</Tag>
        <RightOutlined className="flow-arrow" />
        <Tag color="orange">decide (条件边)</Tag>
        <RightOutlined className="flow-arrow" />
        <Tag color="gold">verdict</Tag>
        <Text type="secondary" style={{ marginLeft: 12 }}>
          decide 不到终轮 ↺ red_argue
        </Text>
      </div>

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24}>
          <Text>辩题</Text>
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="例如：AI 是否会让程序员失业？"
            style={{ marginTop: 4 }}
          />
        </Col>
        <Col xs={24} md={11}>
          <Text strong style={{ color: "#cf1322" }}>
            红方立场（正方）
          </Text>
          <TextArea
            rows={2}
            value={redStance}
            onChange={(e) => setRedStance(e.target.value)}
            style={{ marginTop: 4 }}
          />
        </Col>
        <Col xs={24} md={11}>
          <Text strong style={{ color: "#1677ff" }}>
            蓝方立场（反方）
          </Text>
          <TextArea
            rows={2}
            value={blueStance}
            onChange={(e) => setBlueStance(e.target.value)}
            style={{ marginTop: 4 }}
          />
        </Col>
        <Col xs={24} md={2}>
          <Text>轮次</Text>
          <InputNumber
            min={1}
            max={5}
            value={maxRounds}
            onChange={(v) => setMaxRounds(Number(v) || 3)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </Col>
      </Row>

      <Space wrap style={{ marginBottom: 16 }}>
        {PRESETS.map((p) => (
          <Tag
            key={p.label}
            color="blue"
            style={{ cursor: "pointer" }}
            onClick={() => {
              setTopic(p.topic);
              setRedStance(p.red);
              setBlueStance(p.blue);
            }}
          >
            {p.label}
          </Tag>
        ))}
        {!running ? (
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={run}
            disabled={!topic.trim() || !redStance.trim() || !blueStance.trim()}
          >
            开始辩论
          </Button>
        ) : (
          <Button danger icon={<LoadingOutlined />} onClick={stop}>
            运行中 · 点击中止
          </Button>
        )}
        {currentNode && (
          <Tag color="processing" icon={<LoadingOutlined spin />}>
            正在执行节点：{currentNode}
          </Tag>
        )}
      </Space>

      {error && (
        <Alert type="error" showIcon message={error} style={{ marginTop: 8 }} />
      )}

      {/* 辩论时间线 */}
      {rounds.length === 0 && running && (
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
            tip="正在唤醒辩论图，红方即将开篇立论…"
          >
            <div style={{ height: 48 }} />
          </Spin>
        </Card>
      )}

      {rounds.length > 0 && (
        <>
          {/* 总分头条 */}
          {judgments.length > 0 && (
            <Row
              gutter={16}
              style={{ marginBottom: 16 }}
              align="middle"
              justify="center"
            >
              <Col>
                <Statistic
                  title={<Text style={{ color: "#cf1322" }}>红方累计</Text>}
                  value={totalRed}
                  valueStyle={{
                    color: totalRed >= totalBlue ? "#cf1322" : "#999",
                    fontWeight: 700,
                  }}
                  prefix={<FireOutlined />}
                />
              </Col>
              <Col>
                <Text type="secondary" style={{ fontSize: 24 }}>
                  vs
                </Text>
              </Col>
              <Col>
                <Statistic
                  title={<Text style={{ color: "#1677ff" }}>蓝方累计</Text>}
                  value={totalBlue}
                  valueStyle={{
                    color: totalBlue >= totalRed ? "#1677ff" : "#999",
                    fontWeight: 700,
                  }}
                  prefix={<ThunderboltOutlined />}
                />
              </Col>
            </Row>
          )}

          {rounds.map(({ round, red, blue, judgment }) => (
            <Card
              key={round}
              size="small"
              style={{ marginBottom: 16 }}
              title={
                <Space>
                  <Tag color="default">第 {round} 轮</Tag>
                  {judgment && (
                    <Tag
                      color={
                        judgment.redScore > judgment.blueScore
                          ? "red"
                          : judgment.blueScore > judgment.redScore
                            ? "blue"
                            : "default"
                      }
                    >
                      本轮：红 {judgment.redScore} vs 蓝 {judgment.blueScore}
                    </Tag>
                  )}
                </Space>
              }
            >
              <Row gutter={[16, 16]}>
                <SideCol turn={red} side="red" round={round} />
                <SideCol turn={blue} side="blue" round={round} />
              </Row>
              {judgment ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginTop: 12 }}
                  message={
                    <Space>
                      <span>裁判判词</span>
                      <Progress
                        percent={(judgment.redScore / 10) * 100}
                        size="small"
                        strokeColor="#cf1322"
                        showInfo={false}
                        style={{ width: 80 }}
                      />
                      <Text type="secondary">/</Text>
                      <Progress
                        percent={(judgment.blueScore / 10) * 100}
                        size="small"
                        strokeColor="#1677ff"
                        showInfo={false}
                        style={{ width: 80 }}
                      />
                    </Space>
                  }
                  description={judgment.comment}
                />
              ) : red && blue ? (
                <Alert
                  type="warning"
                  showIcon
                  icon={<LoadingOutlined spin />}
                  style={{ marginTop: 12 }}
                  message="judge 节点正在打分…"
                />
              ) : null}
            </Card>
          ))}

          {verdict && (
            <Card
              size="small"
              style={{
                marginTop: 8,
                borderColor:
                  verdict.winner === "red"
                    ? "#cf1322"
                    : verdict.winner === "blue"
                      ? "#1677ff"
                      : "#999",
              }}
              title={
                <Space>
                  <CrownTwoTone
                    twoToneColor={
                      verdict.winner === "red"
                        ? "#cf1322"
                        : verdict.winner === "blue"
                          ? "#1677ff"
                          : "#bfbfbf"
                    }
                  />
                  <Text strong>
                    最终判决：
                    {verdict.winner === "red"
                      ? "🔥 红方获胜"
                      : verdict.winner === "blue"
                        ? "⚡ 蓝方获胜"
                        : "🤝 平局"}
                  </Text>
                  <Tag color="red">
                    红 {verdict.finalRedScore}
                  </Tag>
                  <Tag color="blue">
                    蓝 {verdict.finalBlueScore}
                  </Tag>
                </Space>
              }
            >
              <Paragraph style={{ marginBottom: 0 }}>
                {verdict.commentary}
              </Paragraph>
            </Card>
          )}

          {done && !verdict && (
            <Alert
              style={{ marginTop: 16 }}
              type="info"
              showIcon
              message="辩论已结束，但未收到 verdict 节点输出"
            />
          )}
        </>
      )}
    </div>
  );
}

function SideCol({
  turn,
  side,
  round,
}: {
  turn?: DebateTurn;
  side: "red" | "blue";
  round: number;
}) {
  const color = side === "red" ? "#cf1322" : "#1677ff";
  const bg = side === "red" ? "#fff1f0" : "#e6f4ff";
  const label = side === "red" ? "红方" : "蓝方";

  return (
    <Col xs={24} md={12}>
      <Card
        size="small"
        style={{
          background: bg,
          borderColor: color,
          height: "100%",
        }}
        title={
          <Space>
            <Avatar
              size={22}
              style={{ background: color, verticalAlign: "middle" }}
            >
              {side === "red" ? "红" : "蓝"}
            </Avatar>
            <Text strong style={{ color }}>
              {label} · 第 {round} 轮
            </Text>
            {turn && <Tag>{toneLabel(turn.emotional_tone)}</Tag>}
          </Space>
        }
      >
        {turn ? (
          <>
            <Paragraph
              type="secondary"
              style={{ fontSize: 12, marginBottom: 8, fontStyle: "italic" }}
            >
              ⤴ 反驳：{turn.rebuttal}
            </Paragraph>
            <ol style={{ paddingLeft: 18, margin: 0 }}>
              {turn.points.map((p, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {p}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <Space>
            <LoadingOutlined spin style={{ color }} />
            <Text type="secondary">{label}发言中…</Text>
          </Space>
        )}
      </Card>
    </Col>
  );
}

function toneLabel(t: Tone) {
  return t === "calm"
    ? "🧊 冷静"
    : t === "fierce"
      ? "🔥 凌厉"
      : t === "sarcastic"
        ? "😏 嘲讽"
        : "💥 激情";
}
