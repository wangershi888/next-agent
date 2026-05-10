"use client";

import { useCallback, useId, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Card,
  Flex,
  Input,
  InputNumber,
  Space,
  Tag,
  Typography,
  theme,
} from "antd";
import type { ArgumentAssistantHumanFinalResume } from "@/lib/types/chat";

const { Text, Paragraph, Title } = Typography;

const PRESET_TOPICS = [
  "气候变化是否应优先于经济增长",
  "人工智能生成内容的版权归属",
  "远程办公对企业创新是利大于弊还是弊大于利",
  "大学教育应更偏通识还是更偏职业训练",
];

type SseState = {
  topic: string;
  passThreshold: number;
  maxIterations: number;
  revisionCount: number;
  draft: string;
  score: number | null;
  scorerFeedback: string;
  passed: boolean;
  passAdvice: string;
  aborted: boolean;
};

const emptyState = (): SseState => ({
  topic: "",
  passThreshold: 9,
  maxIterations: 5,
  revisionCount: 0,
  draft: "",
  score: null,
  scorerFeedback: "",
  passed: false,
  passAdvice: "",
  aborted: false,
});

function pickState(raw: unknown): Partial<SseState> {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const score =
    o.score === null || o.score === undefined
      ? null
      : typeof o.score === "number"
        ? o.score
        : Number(o.score);

  return {
    topic: typeof o.topic === "string" ? o.topic : undefined,
    passThreshold:
      typeof o.passThreshold === "number" ? o.passThreshold : undefined,
    maxIterations:
      typeof o.maxIterations === "number" ? o.maxIterations : undefined,
    revisionCount:
      typeof o.revisionCount === "number" ? o.revisionCount : undefined,
    draft: typeof o.draft === "string" ? o.draft : undefined,
    score: Number.isFinite(score as number) ? (score as number) : null,
    scorerFeedback:
      typeof o.scorerFeedback === "string" ? o.scorerFeedback : undefined,
    passed: typeof o.passed === "boolean" ? o.passed : undefined,
    passAdvice: typeof o.passAdvice === "string" ? o.passAdvice : undefined,
    aborted: typeof o.aborted === "boolean" ? o.aborted : undefined,
  };
}

/** 仅追加、不覆盖 —— 完整流水 */
type StepLogEntry =
  | {
      key: string;
      kind: "params";
      topic: string;
      passThreshold: number;
      maxIterations: number;
    }
  | {
      key: string;
      kind: "writer";
      round: number;
      topic: string;
      /** 本轮编写时可依据的上轮评分建议（首稿为 null） */
      priorFeedback: string | null;
      draft: string;
    }
  | {
      key: string;
      kind: "scorer";
      round: number;
      score: number | null;
      feedback: string;
    }
  | {
      key: string;
      kind: "finalize";
      passAdvice: string;
    }
  | {
      key: string;
      kind: "interrupt_notice";
      draft: string;
      score: number | null;
      feedback: string;
      revisionCount: number;
      maxIterations: number;
      passThreshold: number;
    }
  | {
      key: string;
      kind: "resume_choice";
      action: "force_pass" | "give_up";
    }
  | {
      key: string;
      kind: "human_final";
      passed: boolean;
      passAdvice: string;
      aborted: boolean;
    };

function nextLogKey(prefix: string, index: number) {
  return `${prefix}-${Date.now()}-${index}`;
}

export function ArgumentAssistantTab() {
  const { token } = theme.useToken();
  const formId = useId();
  const [topic, setTopic] = useState(PRESET_TOPICS[0] ?? "");
  const [passThreshold, setPassThreshold] = useState(9);
  const [maxIterations, setMaxIterations] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graphState, setGraphState] = useState<SseState>(emptyState);
  const [stepLog, setStepLog] = useState<StepLogEntry[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [pendingInterrupt, setPendingInterrupt] = useState<{
    draft: string;
    score: number | null;
    feedback: string;
    revisionCount: number;
    maxIterations: number;
    passThreshold: number;
  } | null>(null);

  const consumeStream = useCallback(
    async (
      reqBody:
        | {
            phase: "start";
            threadId: string;
            topic: string;
            passThreshold: number;
            maxIterations: number;
          }
        | { phase: "resume"; threadId: string; resume: ArgumentAssistantHumanFinalResume },
    ) => {
      let seq = 0;
      let lastWriterRound = 0;
      let lastScorerFeedback: string | null = null;
      const topicLabel = topic.trim();

      if (reqBody.phase === "start") {
        lastScorerFeedback = null;
        lastWriterRound = 0;
        setStepLog([
          {
            key: nextLogKey("params", seq++),
            kind: "params",
            topic: reqBody.topic.trim(),
            passThreshold: reqBody.passThreshold,
            maxIterations: reqBody.maxIterations,
          },
        ]);
      }

      const res = await fetch("/api/agents/argument-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
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
            state?: unknown;
            partial?: unknown;
            payload?: unknown;
            message?: string;
          };
          try {
            evt = JSON.parse(jsonStr) as typeof evt;
          } catch {
            continue;
          }

          if (evt.type === "values" && evt.state) {
            setGraphState((prev) => ({ ...prev, ...pickState(evt.state) }));
          } else if (evt.type === "updates" && evt.partial) {
            const p = evt.partial as Record<string, unknown>;
            const nodeKey = Object.keys(p)[0];
            const nodePayload = nodeKey ? p[nodeKey] : undefined;
            if (nodePayload && typeof nodePayload === "object") {
              const partial = pickState(nodePayload);
              setGraphState((prev) => ({
                ...prev,
                ...partial,
              }));

              if (nodeKey === "writer") {
                const round =
                  typeof partial.revisionCount === "number"
                    ? partial.revisionCount
                    : 0;
                lastWriterRound = round;
                const draft = partial.draft ?? "";
                const prior = lastScorerFeedback;
                setStepLog((prevLog) => [
                  ...prevLog,
                  {
                    key: nextLogKey("writer", seq++),
                    kind: "writer" as const,
                    round,
                    topic: topicLabel,
                    priorFeedback: prior,
                    draft,
                  },
                ]);
              } else if (nodeKey === "scorer") {
                const fb = partial.scorerFeedback ?? "";
                const sc =
                  partial.score === undefined ? null : partial.score;
                setStepLog((prevLog) => [
                  ...prevLog,
                  {
                    key: nextLogKey("scorer", seq++),
                    kind: "scorer" as const,
                    round: lastWriterRound,
                    score: sc,
                    feedback: fb,
                  },
                ]);
                lastScorerFeedback = fb;
              } else if (nodeKey === "finalize_success") {
                setStepLog((prevLog) => [
                  ...prevLog,
                  {
                    key: nextLogKey("fin", seq++),
                    kind: "finalize" as const,
                    passAdvice: partial.passAdvice ?? "",
                  },
                ]);
              } else if (nodeKey === "human_final") {
                setStepLog((prevLog) => [
                  ...prevLog,
                  {
                    key: nextLogKey("hum", seq++),
                    kind: "human_final" as const,
                    passed: Boolean(partial.passed),
                    passAdvice: partial.passAdvice ?? "",
                    aborted: Boolean(partial.aborted),
                  },
                ]);
              }
            }
          } else if (evt.type === "interrupt") {
            const p = evt.payload as Record<string, unknown> | undefined;
            if (p && typeof p === "object" && p.kind === "human_final") {
              const interruptDraft =
                typeof p.draft === "string" ? p.draft : "";
              const interruptFeedback =
                typeof p.feedback === "string" ? p.feedback : "";
              const interruptScore =
                typeof p.score === "number"
                  ? p.score
                  : p.score === null
                    ? null
                    : null;
              const interruptRev =
                typeof p.revisionCount === "number" ? p.revisionCount : 0;
              const interruptMax =
                typeof p.maxIterations === "number" ? p.maxIterations : 5;
              const interruptPass =
                typeof p.passThreshold === "number" ? p.passThreshold : 9;

              setPendingInterrupt({
                draft: interruptDraft,
                score: interruptScore,
                feedback: interruptFeedback,
                revisionCount: interruptRev,
                maxIterations: interruptMax,
                passThreshold: interruptPass,
              });

              setStepLog((prevLog) => [
                ...prevLog,
                {
                  key: nextLogKey("intr", seq++),
                  kind: "interrupt_notice" as const,
                  draft: interruptDraft,
                  score: interruptScore,
                  feedback: interruptFeedback,
                  revisionCount: interruptRev,
                  maxIterations: interruptMax,
                  passThreshold: interruptPass,
                },
              ]);
            }
          } else if (evt.type === "error") {
            throw new Error(evt.message ?? "执行出错");
          }
        }
      }
    },
    [topic],
  );

  const runStart = useCallback(async () => {
    const t = topic.trim();
    if (!t || loading) return;

    setLoading(true);
    setError(null);
    setPendingInterrupt(null);
    setGraphState(emptyState());
    setStepLog([]);

    const tid =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${formId}`;

    setThreadId(tid);

    try {
      await consumeStream({
        phase: "start",
        threadId: tid,
        topic: t,
        passThreshold,
        maxIterations,
      });
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
  }, [
    consumeStream,
    formId,
    loading,
    maxIterations,
    passThreshold,
    topic,
  ]);

  const resume = useCallback(
    async (resumePayload: ArgumentAssistantHumanFinalResume) => {
      if (!threadId || loading) return;

    setLoading(true);
    setError(null);
    setPendingInterrupt(null);

    setStepLog((prev) => [
      ...prev,
      {
        key: nextLogKey("resume", prev.length),
        kind: "resume_choice",
        action: resumePayload.action,
      },
    ]);

    try {
      await consumeStream({
        phase: "resume",
        threadId,
        resume: resumePayload,
      });
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
    },
    [consumeStream, loading, threadId],
  );

  return (
    <Layout>
      <Flex vertical gap={16}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            论点编写助手（LangGraph）
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            双 Agent：编写稿 → 评分；未达标则循环改写（State + 条件边）；达到上限后暂停等待你选择（interrupt
            + Command resume）。
          </Paragraph>
        </div>

        <Card size="small" title="主题与门槛">
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <div>
              <Text type="secondary">快捷主题（点击填入）</Text>
              <div style={{ marginTop: 8 }}>
                <Space wrap>
                  {PRESET_TOPICS.map((p) => (
                    <Tag
                      key={p}
                      style={{ cursor: "pointer" }}
                      onClick={() => setTopic(p)}
                    >
                      {p}
                    </Tag>
                  ))}
                </Space>
              </div>
            </div>
            <Input.TextArea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="输入辩论/写作主题"
              autoSize={{ minRows: 2, maxRows: 5 }}
            />
            <Flex gap={16} wrap="wrap">
              <Space>
                <Text>及格分（满分 10）</Text>
                <InputNumber
                  min={1}
                  max={10}
                  value={passThreshold}
                  onChange={(v) => setPassThreshold(typeof v === "number" ? v : 9)}
                />
              </Space>
              <Space>
                <Text>最多改写轮数</Text>
                <InputNumber
                  min={1}
                  max={12}
                  value={maxIterations}
                  onChange={(v) => setMaxIterations(typeof v === "number" ? v : 5)}
                />
              </Space>
              <Button type="primary" onClick={runStart} loading={loading}>
                开始
              </Button>
            </Flex>
          </Space>
        </Card>

        {error ? (
          <Alert type="error" showIcon message={error} />
        ) : null}

        {pendingInterrupt ? (
          <Alert
            type="warning"
            showIcon
            message="已达最大改写次数，仍未达到及格分"
            description={
              <Flex vertical gap={8} style={{ marginTop: 8 }}>
                <Text>
                  当前分数：
                  {pendingInterrupt.score ?? "—"} / 10（及格线{" "}
                  {pendingInterrupt.passThreshold}）
                </Text>
                <Paragraph style={{ marginBottom: 0 }}>
                  <Text strong>末稿：</Text>
                  {pendingInterrupt.draft || "（空）"}
                </Paragraph>
                <Paragraph style={{ marginBottom: 0 }}>
                  <Text strong>评分建议：</Text>
                  {pendingInterrupt.feedback || "—"}
                </Paragraph>
                <Space>
                  <Button
                    type="primary"
                    loading={loading}
                    onClick={() => resume({ action: "force_pass" })}
                  >
                    强制采纳当前稿
                  </Button>
                  <Button danger loading={loading} onClick={() => resume({ action: "give_up" })}>
                    放弃
                  </Button>
                </Space>
              </Flex>
            }
          />
        ) : null}

        <Card
          size="small"
          title="运行记录（按节点追加，不覆盖）"
          style={{
            borderColor: token.colorBorderSecondary,
          }}
        >
          {stepLog.length === 0 ? (
            <Text type="secondary">
              点击开始后，运行参数与各 Agent 的输入/输出会依次追加显示。
            </Text>
          ) : (
            <Space direction="vertical" style={{ width: "100%" }} size={12}>
              {stepLog.map((entry) => (
                <Card
                  key={entry.key}
                  size="small"
                  type="inner"
                  title={
                    entry.kind === "params"
                      ? "运行参数"
                      : entry.kind === "writer"
                        ? `第 ${entry.round} 轮 · 编写 Agent`
                        : entry.kind === "scorer"
                          ? `第 ${entry.round} 轮 · 评分 Agent`
                          : entry.kind === "finalize"
                            ? "达标收尾"
                            : entry.kind === "interrupt_notice"
                              ? "中断 · 待人工选择"
                              : entry.kind === "resume_choice"
                                ? "人工操作"
                                : entry.kind === "human_final"
                                  ? "中断流程结束"
                                  : "—"
                  }
                >
                  {entry.kind === "params" ? (
                    <Space direction="vertical" size={4}>
                      <div>
                        <Text strong>主题：</Text>
                        {entry.topic}
                      </div>
                      <div>
                        <Text strong>及格分：</Text>
                        {entry.passThreshold} / 10 ·{" "}
                        <Text strong>最多改写轮数：</Text>
                        {entry.maxIterations}
                      </div>
                    </Space>
                  ) : null}
                  {entry.kind === "writer" ? (
                    <Space direction="vertical" size={8} style={{ width: "100%" }}>
                      <div>
                        <Text type="secondary">输入 · 主题</Text>
                        <Paragraph style={{ marginBottom: 0 }}>
                          {entry.topic}
                        </Paragraph>
                      </div>
                      <div>
                        <Text type="secondary">
                          输入 · 上轮评分建议（首稿无）
                        </Text>
                        <Paragraph style={{ marginBottom: 0 }}>
                          {entry.priorFeedback ?? "—"}
                        </Paragraph>
                      </div>
                      <div>
                        <Text type="secondary">输出 · 论点稿</Text>
                        <Paragraph style={{ marginBottom: 0 }}>
                          {entry.draft || "—"}
                        </Paragraph>
                      </div>
                    </Space>
                  ) : null}
                  {entry.kind === "scorer" ? (
                    <Space direction="vertical" size={8} style={{ width: "100%" }}>
                      <div>
                        <Text type="secondary">输入（隐式）</Text>
                        <Paragraph style={{ marginBottom: 0 }}>
                          本轮由上一节点写入的论点稿（见同轮「编写 Agent」输出）。
                        </Paragraph>
                      </div>
                      <div>
                        <Text type="secondary">输出 · 得分</Text>
                        <Paragraph style={{ marginBottom: 0 }}>
                          {entry.score ?? "—"} / 10
                        </Paragraph>
                      </div>
                      <div>
                        <Text type="secondary">输出 · 修改建议</Text>
                        <Paragraph style={{ marginBottom: 0 }}>
                          {entry.feedback || "—"}
                        </Paragraph>
                      </div>
                    </Space>
                  ) : null}
                  {entry.kind === "finalize" ? (
                    <Paragraph style={{ marginBottom: 0 }}>
                      <Text strong>通过建议：</Text>
                      {entry.passAdvice || "—"}
                    </Paragraph>
                  ) : null}
                  {entry.kind === "interrupt_notice" ? (
                    <Space direction="vertical" size={6}>
                      <Text>
                        已达轮数上限仍未及格（第 {entry.revisionCount} 稿 · 及格线{" "}
                        {entry.passThreshold}）。
                      </Text>
                      <Paragraph style={{ marginBottom: 0 }}>
                        <Text strong>末稿：</Text>
                        {entry.draft || "—"}
                      </Paragraph>
                      <Paragraph style={{ marginBottom: 0 }}>
                        <Text strong>分数：</Text>
                        {entry.score ?? "—"} / 10 ——{" "}
                        <Text strong>建议：</Text>
                        {entry.feedback || "—"}
                      </Paragraph>
                    </Space>
                  ) : null}
                  {entry.kind === "resume_choice" ? (
                    <Text>
                      用户选择：
                      <Text strong>
                        {entry.action === "force_pass"
                          ? "强制采纳当前稿"
                          : "放弃"}
                      </Text>
                    </Text>
                  ) : null}
                  {entry.kind === "human_final" ? (
                    entry.aborted ? (
                      <Alert type="info" showIcon message="已放弃采纳末稿" />
                    ) : (
                      <Alert
                        type={entry.passed ? "success" : "info"}
                        showIcon
                        message={entry.passed ? "已采纳（含强制通过）" : "结束"}
                        description={entry.passAdvice || "—"}
                      />
                    )
                  ) : null}
                </Card>
              ))}
              <Text type="secondary" style={{ fontSize: 12 }}>
                最新状态摘要 · 稿次 {graphState.revisionCount || 0} /{" "}
                {graphState.maxIterations || maxIterations}
                {graphState.score != null
                  ? ` · 最近评分 ${graphState.score}/10`
                  : ""}
              </Text>
            </Space>
          )}
        </Card>
      </Flex>
    </Layout>
  );
}

function Layout({ children }: { children: ReactNode }) {
  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "16px 0 48px" }}>
      {children}
    </div>
  );
}
