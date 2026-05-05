"use client";

import { useMemo, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Empty,
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
  AimOutlined,
  AuditOutlined,
  BulbOutlined,
  CheckCircleTwoTone,
  CloseCircleTwoTone,
  CommentOutlined,
  IdcardOutlined,
  LoadingOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
  StarOutlined,
} from "@ant-design/icons";

const { Title, Paragraph, Text } = Typography;
const { TextArea } = Input;

type StageStatus = "idle" | "running" | "done";
type SubStatus = "idle" | "running" | "done";

type RoundState = {
  angle?: string;
  question?: string;
  answer?: string;
  score?: number;
  comment?: string;
  questionStatus: SubStatus;
  answerStatus: SubStatus;
  scoreStatus: SubStatus;
};

type Decision = { hire_decision: "hire" | "no_hire"; reason: string };

type StageState = {
  status: StageStatus;
  profile?: string;
  angles?: string[];
  decision?: Decision;
};

type RouteEvent =
  | { type: "start"; position: string; resume: string; count: number }
  | {
      type: "stage";
      stage: "profile" | "angles" | "decision";
      status: "running" | "done";
      payload?: any;
    }
  | {
      type: "round";
      round: number;
      sub: "question" | "answer" | "score";
      status: "running" | "done";
      payload?: any;
    }
  | { type: "end" }
  | { type: "error"; error: string };

const PRESETS = [
  {
    label: "高级前端 / 字节",
    position: "高级前端工程师",
    resume:
      "5 年前端经验，主导过百万 DAU 应用重构，熟悉 Next.js / SSR；近期带组做 LowCode 编辑器。",
  },
  {
    label: "AI 应用工程师",
    position: "AI 应用工程师",
    resume:
      "3 年后端 + 1 年 AI。主导落地企业 RAG 知识库（pgvector + LangChain），上线后 PV 破百万。",
  },
  {
    label: "资深 SRE",
    position: "资深 SRE",
    resume:
      "8 年 SRE，负责双十一 80W QPS 网关稳定性；推动 Nginx → Envoy 迁移，P99 下降 40%。",
  },
];

export default function LangChainDemo() {
  const [position, setPosition] = useState(PRESETS[0].position);
  const [resume, setResume] = useState(PRESETS[0].resume);
  const [count, setCount] = useState(3);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [profileStage, setProfileStage] = useState<StageState>({
    status: "idle",
  });
  const [anglesStage, setAnglesStage] = useState<StageState>({
    status: "idle",
  });
  const [decisionStage, setDecisionStage] = useState<StageState>({
    status: "idle",
  });
  const [rounds, setRounds] = useState<RoundState[]>([]);

  const abortRef = useRef<AbortController | null>(null);

  function reset(n: number) {
    setError(null);
    setProfileStage({ status: "idle" });
    setAnglesStage({ status: "idle" });
    setDecisionStage({ status: "idle" });
    setRounds(
      Array.from({ length: n }, () => ({
        questionStatus: "idle",
        answerStatus: "idle",
        scoreStatus: "idle",
      })),
    );
  }

  function applyEvent(ev: RouteEvent) {
    if (ev.type === "stage") {
      const setter =
        ev.stage === "profile"
          ? setProfileStage
          : ev.stage === "angles"
            ? setAnglesStage
            : setDecisionStage;
      setter((prev) => ({
        ...prev,
        status: ev.status === "done" ? "done" : "running",
        ...(ev.status === "done" && ev.payload ? ev.payload : {}),
      }));
    } else if (ev.type === "round") {
      setRounds((prev) => {
        const copy = [...prev];
        const idx = ev.round - 1;
        if (!copy[idx]) {
          copy[idx] = {
            questionStatus: "idle",
            answerStatus: "idle",
            scoreStatus: "idle",
          };
        }
        const r = { ...copy[idx] };
        const subKey = (ev.sub + "Status") as
          | "questionStatus"
          | "answerStatus"
          | "scoreStatus";
        r[subKey] = ev.status === "done" ? "done" : "running";
        if (ev.status === "done" && ev.payload) {
          Object.assign(r, ev.payload);
        }
        copy[idx] = r;
        return copy;
      });
    } else if (ev.type === "error") {
      setError(ev.error);
    }
  }

  async function run() {
    reset(count);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const resp = await fetch("/api/langchain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position, resume, count }),
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

  // Steps：profile / angles / round1...N / decision
  const stepsItems = useMemo(() => {
    const items: { title: string; status: "wait" | "process" | "finish"; icon?: React.ReactNode }[] = [];
    items.push({
      title: "画像",
      status: stageStepStatus(profileStage.status),
      icon:
        profileStage.status === "running" ? <LoadingOutlined /> : <IdcardOutlined />,
    });
    items.push({
      title: "考察角度",
      status: stageStepStatus(anglesStage.status),
      icon:
        anglesStage.status === "running" ? <LoadingOutlined /> : <AimOutlined />,
    });
    rounds.forEach((r, i) => {
      const allDone =
        r.questionStatus === "done" &&
        r.answerStatus === "done" &&
        r.scoreStatus === "done";
      const anyRunning =
        r.questionStatus === "running" ||
        r.answerStatus === "running" ||
        r.scoreStatus === "running";
      const anyStarted =
        r.questionStatus !== "idle" ||
        r.answerStatus !== "idle" ||
        r.scoreStatus !== "idle";
      items.push({
        title: `第 ${i + 1} 题`,
        status: allDone ? "finish" : anyStarted ? "process" : "wait",
        icon: anyRunning ? <LoadingOutlined /> : <CommentOutlined />,
      });
    });
    items.push({
      title: "决策",
      status: stageStepStatus(decisionStage.status),
      icon:
        decisionStage.status === "running" ? <LoadingOutlined /> : <AuditOutlined />,
    });
    return items;
  }, [profileStage, anglesStage, rounds, decisionStage]);

  const currentStepIdx = (() => {
    for (let i = stepsItems.length - 1; i >= 0; i--) {
      if (stepsItems[i].status !== "wait") return i;
    }
    return 0;
  })();

  return (
    <div className="demo-card">
      <Title level={4} style={{ marginTop: 0 }}>
        极简串行 LCEL · 真正的「一题一答一评」
      </Title>
      <Paragraph type="secondary" style={{ marginTop: -4 }}>
        每个 Runnable 只做一件极简的事，前段输出直接喂给后段。
        <Text strong>整条流水线完全串行</Text>：上一道题答完 + 评完，才会出下一道题；
        所以候选人每次作答都能看到完整的上下文（保持人设一致）。
        总 LLM 调用 = <Text code>2 + 3 × N + 1</Text>（N 是题量）。
      </Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={8}>
          <Text>岗位</Text>
          <Input
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            style={{ marginTop: 4 }}
          />
        </Col>
        <Col xs={24} md={12}>
          <Text>简历摘要</Text>
          <TextArea
            rows={2}
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            style={{ marginTop: 4 }}
          />
        </Col>
        <Col xs={24} md={4}>
          <Text>题量 (1-5)</Text>
          <InputNumber
            min={1}
            max={5}
            value={count}
            onChange={(v) => setCount(Number(v) || 3)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
            disabled={running}
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
              setPosition(p.position);
              setResume(p.resume);
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
            disabled={!position.trim() || !resume.trim()}
          >
            启动串行流水线（{count} 题）
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

      {/* 横向进度条 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Steps
          current={currentStepIdx}
          size="small"
          labelPlacement="vertical"
          items={stepsItems}
        />
      </Card>

      {/* Stage: profile */}
      <StageCard
        n={1}
        title="候选人画像"
        subtitle="profilePrompt → ChatDeepSeek → ProfileSchema"
        status={profileStage.status}
      >
        {profileStage.profile ? (
          <Tag color="purple" style={{ fontSize: 14, padding: "4px 10px" }}>
            <BulbOutlined /> {profileStage.profile}
          </Tag>
        ) : (
          <Spinner running={profileStage.status === "running"} />
        )}
      </StageCard>

      {/* Stage: angles */}
      <StageCard
        n={2}
        title={`${count} 个考察角度`}
        subtitle="anglesPrompt → ChatDeepSeek → AnglesSchema(动态长度)"
        status={anglesStage.status}
      >
        {anglesStage.angles ? (
          <Space wrap>
            {anglesStage.angles.map((a, i) => (
              <Tag key={i} color="cyan">
                {i + 1}. {a}
              </Tag>
            ))}
          </Space>
        ) : (
          <Spinner running={anglesStage.status === "running"} />
        )}
      </StageCard>

      {/* Rounds */}
      {rounds.map((r, i) => (
        <RoundCard
          key={i}
          n={i + 3}
          roundIdx={i + 1}
          round={r}
          previousAllDone={
            i === 0
              ? anglesStage.status === "done"
              : rounds[i - 1].scoreStatus === "done"
          }
        />
      ))}

      {/* Stage: decision */}
      <StageCard
        n={rounds.length + 3}
        title="最终决策"
        subtitle="decisionPrompt → ChatDeepSeek → DecisionSchema"
        status={decisionStage.status}
      >
        {decisionStage.decision ? (
          <Alert
            type={
              decisionStage.decision.hire_decision === "hire"
                ? "success"
                : "error"
            }
            icon={
              decisionStage.decision.hire_decision === "hire" ? (
                <CheckCircleTwoTone twoToneColor="#52c41a" />
              ) : (
                <CloseCircleTwoTone twoToneColor="#cf1322" />
              )
            }
            showIcon
            message={
              <Text strong>
                {decisionStage.decision.hire_decision === "hire"
                  ? "Hire ✅"
                  : "No Hire ❌"}
              </Text>
            }
            description={decisionStage.decision.reason}
          />
        ) : (
          <Spinner running={decisionStage.status === "running"} />
        )}
      </StageCard>
    </div>
  );
}

// ============== 子组件 ==============

function RoundCard({
  n,
  roundIdx,
  round,
  previousAllDone,
}: {
  n: number;
  roundIdx: number;
  round: RoundState;
  previousAllDone: boolean;
}) {
  const allDone =
    round.questionStatus === "done" &&
    round.answerStatus === "done" &&
    round.scoreStatus === "done";
  const anyStarted =
    round.questionStatus !== "idle" ||
    round.answerStatus !== "idle" ||
    round.scoreStatus !== "idle";

  const status: StageStatus = allDone
    ? "done"
    : anyStarted
      ? "running"
      : "idle";

  return (
    <StageCard
      n={n}
      title={`第 ${roundIdx} 题 · 串行 Q → A → S`}
      subtitle="questionChain → answerChain → scoreChain"
      status={status}
    >
      {!previousAllDone && status === "idle" ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="等待上一轮完成…"
        />
      ) : (
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <SubStep
            label="出题"
            color="#1677ff"
            icon={<QuestionCircleOutlined />}
            status={round.questionStatus}
            rightTag={round.angle ? <Tag color="cyan">{round.angle}</Tag> : null}
          >
            {round.question}
          </SubStep>
          <SubStep
            label="作答"
            color="#722ed1"
            icon={<CommentOutlined />}
            status={round.answerStatus}
          >
            {round.answer}
          </SubStep>
          <SubStep
            label="评分"
            color="#d48806"
            icon={<StarOutlined />}
            status={round.scoreStatus}
          >
            {typeof round.score === "number" ? (
              <div>
                <Space style={{ marginBottom: 4 }}>
                  <Tag color={scoreColor(round.score)}>{round.score}/10</Tag>
                  <Text type="secondary">{round.comment}</Text>
                </Space>
                <Progress
                  percent={round.score * 10}
                  size="small"
                  showInfo={false}
                  strokeColor={progressStroke(round.score)}
                />
              </div>
            ) : null}
          </SubStep>
        </Space>
      )}
    </StageCard>
  );
}

function SubStep({
  label,
  color,
  icon,
  status,
  rightTag,
  children,
}: {
  label: string;
  color: string;
  icon: React.ReactNode;
  status: SubStatus;
  rightTag?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        opacity: status === "idle" ? 0.4 : 1,
      }}
    >
      <Avatar
        size={28}
        style={{
          background: status === "done" ? color : "#bfbfbf",
          color: "#fff",
          flexShrink: 0,
        }}
        icon={status === "running" ? <LoadingOutlined /> : icon}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Space size={6} style={{ marginBottom: 4 }}>
          <Text strong style={{ color }}>
            {label}
          </Text>
          {rightTag}
          {status === "running" && (
            <Tag color="processing" icon={<LoadingOutlined spin />}>
              进行中
            </Tag>
          )}
          {status === "done" && <Tag color="success">已完成</Tag>}
        </Space>
        {status === "idle" ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            待运行
          </Text>
        ) : status === "running" && !children ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            <LoadingOutlined spin /> LLM 推理中…
          </Text>
        ) : (
          <div>{children}</div>
        )}
      </div>
    </div>
  );
}

function StageCard({
  n,
  title,
  subtitle,
  status,
  children,
}: {
  n: number;
  title: string;
  subtitle: string;
  status: StageStatus;
  children: React.ReactNode;
}) {
  const tag =
    status === "running" ? (
      <Tag color="processing" icon={<LoadingOutlined spin />}>
        进行中
      </Tag>
    ) : status === "done" ? (
      <Tag color="success">已完成</Tag>
    ) : (
      <Tag>待运行</Tag>
    );
  const dimmed = status === "idle";
  return (
    <Card
      size="small"
      style={{
        marginBottom: 12,
        opacity: dimmed ? 0.55 : 1,
        borderStyle: dimmed ? "dashed" : "solid",
      }}
      title={
        <Space size={10}>
          <Avatar
            size={24}
            style={{
              background: status === "done" ? "#52c41a" : "#1677ff",
              color: "#fff",
              fontWeight: 600,
            }}
          >
            {n}
          </Avatar>
          <Text strong>{title}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {subtitle}
          </Text>
          {tag}
        </Space>
      }
    >
      {children}
    </Card>
  );
}

function Spinner({ running }: { running: boolean }) {
  if (!running)
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="等待上一个 stage"
      />
    );
  return (
    <div style={{ padding: "16px 0", textAlign: "center" }}>
      <Spin indicator={<LoadingOutlined spin />} tip="LLM 推理中…">
        <div style={{ height: 24 }} />
      </Spin>
    </div>
  );
}

function stageStepStatus(s: StageStatus): "wait" | "process" | "finish" {
  return s === "done" ? "finish" : s === "running" ? "process" : "wait";
}

function scoreColor(s: number) {
  return s >= 8 ? "green" : s >= 6 ? "blue" : s >= 4 ? "orange" : "red";
}

function progressStroke(s: number) {
  return s >= 8 ? "#52c41a" : s >= 6 ? "#1677ff" : s >= 4 ? "#faad14" : "#cf1322";
}
