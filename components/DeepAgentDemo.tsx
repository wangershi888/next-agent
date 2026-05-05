"use client";

import { useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  List,
  Row,
  Space,
  Spin,
  Tag,
  Tabs,
  Typography,
  message,
} from "antd";
import {
  CheckCircleTwoTone,
  ClockCircleTwoTone,
  LoadingOutlined,
  PlayCircleOutlined,
  FileTextOutlined,
  RocketOutlined,
} from "@ant-design/icons";

const { Title, Paragraph, Text } = Typography;

type Todo = { content: string; status: "pending" | "in_progress" | "completed" };
type Msg = {
  role: string;
  content: string;
  name?: string;
  tool_calls?: { id: string; name: string; args: any }[];
  tool_call_id?: string;
};

type LogEntry = {
  ts: number;
  kind: "node" | "tool_call" | "tool_result" | "ai" | "user";
  node?: string;
  text: string;
  tone?: "blue" | "purple" | "gold" | "green" | "default";
};

type RouteEvent =
  | { type: "start"; destination: string; days: number; preference: string; budget: string }
  | {
      type: "update";
      node: string;
      payload: { messages?: Msg[]; todos?: Todo[]; files?: Record<string, string> };
    }
  | { type: "end" }
  | { type: "error"; error: string };

const PRESETS = [
  { d: "京都", days: 4, pref: "情侣 / 文艺 / 慢节奏", budget: "中等" },
  { d: "成都", days: 3, pref: "亲子 / 美食优先", budget: "舒适" },
  { d: "冰岛", days: 7, pref: "自驾 / 极光 / 摄影", budget: "豪华" },
];

export default function DeepAgentDemo() {
  const [destination, setDestination] = useState(PRESETS[0].d);
  const [days, setDays] = useState(PRESETS[0].days);
  const [preference, setPreference] = useState(PRESETS[0].pref);
  const [budget, setBudget] = useState(PRESETS[0].budget);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const seenToolCallIds = useRef<Set<string>>(new Set());
  const seenAiContent = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  function reset() {
    setError(null);
    setDone(false);
    setTodos([]);
    setFiles({});
    setLog([]);
    seenToolCallIds.current.clear();
    seenAiContent.current.clear();
  }

  function pushLog(entry: Omit<LogEntry, "ts">) {
    setLog((prev) => [...prev, { ...entry, ts: Date.now() }]);
  }

  function applyEvent(ev: RouteEvent) {
    if (ev.type === "update") {
      const { node, payload } = ev;

      if (Array.isArray(payload.todos)) setTodos(payload.todos);
      if (payload.files) setFiles((prev) => ({ ...prev, ...payload.files }));

      if (Array.isArray(payload.messages)) {
        for (const m of payload.messages) {
          if (m.role === "ai" || m.role === "AIMessage" || m.role === "assistant") {
            if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
              for (const tc of m.tool_calls) {
                if (seenToolCallIds.current.has(tc.id)) continue;
                seenToolCallIds.current.add(tc.id);
                pushLog({
                  kind: "tool_call",
                  node,
                  text: `${tc.name}(${formatArgs(tc.args)})`,
                  tone:
                    tc.name === "task"
                      ? "purple"
                      : tc.name === "write_todos"
                      ? "blue"
                      : tc.name === "write_file"
                      ? "green"
                      : "gold",
                });
              }
            } else if (m.content && !seenAiContent.current.has(m.content)) {
              seenAiContent.current.add(m.content);
              pushLog({
                kind: "ai",
                node,
                text: m.content,
                tone: "default",
              });
            }
          } else if (m.role === "tool" || m.role === "ToolMessage") {
            const text = (m.content || "").slice(0, 500);
            pushLog({
              kind: "tool_result",
              node,
              text: `[${m.name ?? "tool"}] ${text}`,
              tone: "default",
            });
          }
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
      const resp = await fetch("/api/deepagent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination, days, preference, budget }),
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
          } catch {
            // ignore
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

  const fileItems = useMemo(() => Object.entries(files), [files]);

  return (
    <div className="demo-card">
      <Title level={4} style={{ marginTop: 0 }}>
        多智能体旅行规划师 · DeepAgent 四件套
      </Title>
      <Paragraph type="secondary" style={{ marginTop: -4 }}>
        主 Agent 接到任务后会先用 <Text code>write_todos</Text> 拆解出待办清单，
        然后通过 <Text code>task</Text> 工具把不同子任务委派给三个 Sub-Agent
        （景点 / 美食 / 出行），最后用 <Text code>write_file</Text>
        把整理好的方案写入 <Text code>trip-plan.md</Text>。
        这条工作流刚好对应 DeepAgent 的四件套：<Text strong>规划工具 / 子 Agent / 文件系统 / 详细系统提示</Text>。
      </Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}>
          <Text>目的地</Text>
          <Input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            style={{ marginTop: 4 }}
          />
        </Col>
        <Col xs={12} md={4}>
          <Text>天数</Text>
          <InputNumber
            min={1}
            max={10}
            value={days}
            onChange={(v) => setDays(Number(v) || 3)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </Col>
        <Col xs={24} md={8}>
          <Text>出行偏好</Text>
          <Input
            value={preference}
            onChange={(e) => setPreference(e.target.value)}
            style={{ marginTop: 4 }}
          />
        </Col>
        <Col xs={24} md={6}>
          <Text>预算档次</Text>
          <Input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            style={{ marginTop: 4 }}
          />
        </Col>
      </Row>

      <Space wrap style={{ marginBottom: 16 }}>
        {PRESETS.map((p) => (
          <Tag
            key={p.d}
            color="blue"
            style={{ cursor: "pointer" }}
            onClick={() => {
              setDestination(p.d);
              setDays(p.days);
              setPreference(p.pref);
              setBudget(p.budget);
            }}
          >
            {p.d} · {p.days}天 · {p.budget}
          </Tag>
        ))}
        {!running ? (
          <Button
            type="primary"
            icon={<RocketOutlined />}
            onClick={run}
            disabled={!destination.trim()}
          >
            启动 DeepAgent
          </Button>
        ) : (
          <Button danger icon={<LoadingOutlined />} onClick={stop}>
            运行中 · 点击中止
          </Button>
        )}
      </Space>

      {error && (
        <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />
      )}

      <Row gutter={16}>
        <Col xs={24} md={9}>
          <Card
            size="small"
            title={
              <Space>
                <FileTextOutlined />
                <span>规划工具 · TODO List</span>
                <Badge count={todos.filter((t) => t.status === "completed").length} />
                <Text type="secondary">/ {todos.length}</Text>
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            {todos.length === 0 ? (
              running ? (
                <div style={{ padding: "24px 0", textAlign: "center" }}>
                  <Spin
                    indicator={<LoadingOutlined spin />}
                    tip="主 Agent 正在调用 write_todos 拆解任务…"
                  >
                    <div style={{ height: 24 }} />
                  </Spin>
                </div>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="主 Agent 尚未生成 TODO"
                />
              )
            ) : (
              <List
                size="small"
                dataSource={todos}
                renderItem={(t) => (
                  <List.Item>
                    <Space align="start">
                      {t.status === "completed" ? (
                        <CheckCircleTwoTone twoToneColor="#52c41a" />
                      ) : t.status === "in_progress" ? (
                        <PlayCircleOutlined style={{ color: "#1677ff" }} />
                      ) : (
                        <ClockCircleTwoTone twoToneColor="#bfbfbf" />
                      )}
                      <span
                        style={{
                          textDecoration:
                            t.status === "completed" ? "line-through" : "none",
                          color: t.status === "completed" ? "#9ca3af" : undefined,
                        }}
                      >
                        {t.content}
                      </span>
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </Card>

          <Card
            size="small"
            title={
              <Space>
                <FileTextOutlined />
                <span>文件系统 · Files</span>
                <Badge count={fileItems.length} />
              </Space>
            }
          >
            {fileItems.length === 0 ? (
              running ? (
                <div style={{ padding: "24px 0", textAlign: "center" }}>
                  <Spin
                    indicator={<LoadingOutlined spin />}
                    tip="文件会在所有子 Agent 汇报完成后写入…"
                  >
                    <div style={{ height: 24 }} />
                  </Spin>
                </div>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="尚未写入文件"
                />
              )
            ) : (
              <Tabs
                size="small"
                items={fileItems.map(([name, content]) => ({
                  key: name,
                  label: name,
                  children: (
                    <pre
                      style={{
                        maxHeight: 360,
                        overflow: "auto",
                        background: "#fafafa",
                        padding: 12,
                        borderRadius: 6,
                        whiteSpace: "pre-wrap",
                        fontSize: 12.5,
                        margin: 0,
                      }}
                    >
                      {content}
                    </pre>
                  ),
                }))}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} md={15}>
          <Card
            size="small"
            title={
              <Space>
                <span>Agent 活动流</span>
                {running && <Tag color="processing">运行中</Tag>}
                {done && <Tag color="success">已完成</Tag>}
              </Space>
            }
          >
            {log.length === 0 ? (
              running ? (
                <div style={{ padding: "32px 0", textAlign: "center" }}>
                  <Spin
                    indicator={<LoadingOutlined spin />}
                    tip="正在等待主 Agent 的第一条输出，DeepSeek 推理中…"
                  >
                    <div style={{ height: 32 }} />
                  </Spin>
                </div>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="点击「启动 DeepAgent」后这里会实时打印工具调用与子 Agent 委派"
                />
              )
            ) : (
              <div className="event-log">
                {log.map((e, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <Space size={6} style={{ marginRight: 6 }}>
                      <Tag
                        color={
                          e.kind === "tool_call"
                            ? e.tone
                            : e.kind === "tool_result"
                            ? "default"
                            : e.kind === "ai"
                            ? "blue"
                            : "default"
                        }
                      >
                        {e.kind}
                      </Tag>
                      {e.node && (
                        <Text style={{ color: "#93c5fd", fontSize: 12 }}>
                          @{e.node}
                        </Text>
                      )}
                    </Space>
                    <span className="ev-content">{e.text}</span>
                  </div>
                ))}
                {running && (
                  <div style={{ marginTop: 12 }}>
                    <Space>
                      <LoadingOutlined spin style={{ color: "#1677ff" }} />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Agent 仍在思考下一步…
                      </Text>
                    </Space>
                  </div>
                )}
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function formatArgs(args: any) {
  if (args == null) return "";
  try {
    const s = JSON.stringify(args);
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  } catch {
    return String(args);
  }
}
