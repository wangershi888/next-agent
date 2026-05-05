"use client";

import { useMemo, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Input,
  List,
  Row,
  Space,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  AuditOutlined,
  BarChartOutlined,
  BulbOutlined,
  BranchesOutlined,
  CheckCircleTwoTone,
  ClockCircleTwoTone,
  DollarOutlined,
  EditOutlined,
  ExperimentOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  LoadingOutlined,
  PlayCircleOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
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
  kind: "tool_call" | "tool_result" | "ai";
  node?: string;
  text: string;
  tone?: "blue" | "purple" | "gold" | "green" | "magenta" | "default";
};

type Decision = {
  ts: number;
  who: string; // 哪个 agent 做的决策（主 agent 或 subagent 名）
  situation: string;
  options: string[];
  choice: string;
  reason: string;
  confidence: "high" | "medium" | "low";
};

type RouteEvent =
  | { type: "start"; product: string; audience: string; focus: string }
  | {
      type: "update";
      node: string;
      payload: {
        messages?: Msg[];
        todos?: Todo[];
        files?: Record<string, string>;
      };
    }
  | { type: "end" }
  | { type: "error"; error: string };

type SubAgentStatus = "idle" | "active" | "done";

const SUBAGENTS: {
  name: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  desc: string;
}[] = [
  {
    name: "product-researcher",
    label: "产品研究员",
    icon: <FileSearchOutlined />,
    color: "#1677ff",
    desc: "调研产品功能 / 客户 / 技术栈",
  },
  {
    name: "market-analyst",
    label: "市场分析师",
    icon: <BarChartOutlined />,
    color: "#13c2c2",
    desc: "估算 TAM/SAM/SOM 与竞争格局",
  },
  {
    name: "financial-analyst",
    label: "财务分析师",
    icon: <DollarOutlined />,
    color: "#52c41a",
    desc: "营收 / 估值 / 5 年预测",
  },
  {
    name: "swot-analyst",
    label: "SWOT 分析师",
    icon: <ExperimentOutlined />,
    color: "#722ed1",
    desc: "综合前述文件给出 SWOT",
  },
  {
    name: "report-writer",
    label: "报告撰稿人",
    icon: <EditOutlined />,
    color: "#fa8c16",
    desc: "整合所有材料写初稿",
  },
  {
    name: "fact-checker",
    label: "事实核查员",
    icon: <SafetyCertificateOutlined />,
    color: "#cf1322",
    desc: "审查初稿 → 修订建议",
  },
];

const PRESETS = [
  {
    label: "Notion",
    product: "Notion",
    audience: "投资人 + 产品负责人",
    focus: "市场地位 + AI 战略",
  },
  {
    label: "Linear",
    product: "Linear",
    audience: "竞品产品经理",
    focus: "对 Jira 的差异化竞争",
  },
  {
    label: "Figma",
    product: "Figma",
    audience: "战略部 / 投资人",
    focus: "IPO 估值 + Adobe 收购失败后的格局",
  },
];

export default function DeepAgentDemo() {
  const [product, setProduct] = useState(PRESETS[0].product);
  const [audience, setAudience] = useState(PRESETS[0].audience);
  const [focus, setFocus] = useState(PRESETS[0].focus);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [factCheckRounds, setFactCheckRounds] = useState(0);
  const [activeSubagent, setActiveSubagent] = useState<string | null>(null);
  const [doneSubagents, setDoneSubagents] = useState<Set<string>>(new Set());
  // 每个 sub-agent 被调用过几次（体现"重调"——同一个 sub-agent 被叫第二次说明 agent 决定迭代）
  const [subagentCallCount, setSubagentCallCount] = useState<Record<string, number>>({});
  const seenToolCallIds = useRef<Set<string>>(new Set());
  const seenAiContent = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  function reset() {
    setError(null);
    setDone(false);
    setTodos([]);
    setFiles({});
    setLog([]);
    setDecisions([]);
    setFactCheckRounds(0);
    setActiveSubagent(null);
    setDoneSubagents(new Set());
    setSubagentCallCount({});
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
          if (
            m.role === "ai" ||
            m.role === "AIMessage" ||
            m.role === "assistant"
          ) {
            if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
              for (const tc of m.tool_calls) {
                if (seenToolCallIds.current.has(tc.id)) continue;
                seenToolCallIds.current.add(tc.id);

                // 追踪当前活跃 subagent + 调用计数
                if (tc.name === "task") {
                  const subType =
                    tc.args?.subagent_type ?? tc.args?.subagentType;
                  if (subType) {
                    setSubagentCallCount((m) => ({
                      ...m,
                      [subType]: (m[subType] ?? 0) + 1,
                    }));
                    if (subType === "fact-checker") {
                      setFactCheckRounds((r) => r + 1);
                    }
                    setActiveSubagent((prev) => {
                      if (prev && prev !== subType) {
                        setDoneSubagents((s) => {
                          const next = new Set(s);
                          next.add(prev);
                          return next;
                        });
                      }
                      return subType;
                    });
                  }
                }

                // 抓住 record_decision —— 这就是「自主决策」的事件
                if (tc.name === "record_decision") {
                  const a = tc.args ?? {};
                  setDecisions((prev) => [
                    ...prev,
                    {
                      ts: Date.now(),
                      who: node ?? "agent",
                      situation: String(a.situation ?? ""),
                      options: Array.isArray(a.options)
                        ? a.options.map(String)
                        : [],
                      choice: String(a.choice ?? ""),
                      reason: String(a.reason ?? ""),
                      confidence:
                        a.confidence === "high" ||
                        a.confidence === "medium" ||
                        a.confidence === "low"
                          ? a.confidence
                          : "medium",
                    },
                  ]);
                }

                pushLog({
                  kind: "tool_call",
                  node,
                  text: `${tc.name}(${formatArgs(tc.args)})`,
                  tone: toneOfTool(tc.name),
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
            const text = (m.content || "").slice(0, 600);
            pushLog({
              kind: "tool_result",
              node,
              text: `[${m.name ?? "tool"}] ${text}`,
              tone: "default",
            });

            // task 工具 result 回来意味着该 subagent 已经返回主 agent
            if (m.name === "task") {
              setActiveSubagent((prev) => {
                if (prev) {
                  setDoneSubagents((s) => {
                    const next = new Set(s);
                    next.add(prev);
                    return next;
                  });
                }
                return null;
              });
            }
          }
        }
      }
    } else if (ev.type === "end") {
      setDone(true);
      setActiveSubagent((prev) => {
        if (prev) {
          setDoneSubagents((s) => {
            const next = new Set(s);
            next.add(prev);
            return next;
          });
        }
        return null;
      });
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
        body: JSON.stringify({ product, audience, focus }),
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

  const fileItems = useMemo(() => Object.entries(files), [files]);

  function statusOf(name: string): SubAgentStatus {
    if (activeSubagent === name) return "active";
    if (doneSubagents.has(name)) return "done";
    return "idle";
  }

  return (
    <div className="demo-card">
      <Title level={4} style={{ marginTop: 0 }}>
        竞品调研报告代理 · DeepAgent 自主决策版
      </Title>
      <Paragraph type="secondary" style={{ marginTop: -4 }}>
        系统提示里**故意没有「第一步、第二步」的脚本**——只给目标、资源、价值观、十字路口。
        agent 自己决定要调哪几个 sub-agent / 调几次 / 跳过哪步 / fact-check 后是修订还是重做。
        每个分叉点必须用 <Text code>record_decision</Text> 把判断外化出来，
        于是你能在下面的「决策时刻」面板里看到 agent 的思考链路。
      </Paragraph>

      {/* Sub-agent 状态徽章栏 —— 显示调用次数体现"是否被重调" */}
      <Card
        size="small"
        title={
          <Space size={8}>
            <BranchesOutlined />
            <span>专家 Agent 池（agent 自主决定调用谁 / 几次 / 是否跳过）</span>
            {factCheckRounds > 0 && (
              <Tag color="purple">fact-check 轮数 × {factCheckRounds}</Tag>
            )}
          </Space>
        }
        style={{ marginBottom: 12 }}
      >
        <Row gutter={[8, 8]}>
          {SUBAGENTS.map((sa) => {
            const status = statusOf(sa.name);
            const calls = subagentCallCount[sa.name] ?? 0;
            return (
              <Col key={sa.name} xs={12} sm={8} md={4}>
                <Tooltip title={sa.desc}>
                  <Card
                    size="small"
                    style={{
                      borderColor:
                        status === "active"
                          ? sa.color
                          : status === "done"
                            ? "#52c41a"
                            : "#d9d9d9",
                      background:
                        status === "active"
                          ? `${sa.color}10`
                          : status === "done"
                            ? "#f6ffed"
                            : "#fafafa",
                      transition: "all 0.3s",
                    }}
                    styles={{ body: { padding: 8 } }}
                  >
                    <Space size={6} align="center" style={{ width: "100%" }}>
                      <Badge count={calls > 1 ? calls : 0} size="small" offset={[0, 0]}>
                        <Avatar
                          size={26}
                          style={{
                            background:
                              status === "active"
                                ? sa.color
                                : status === "done"
                                  ? "#52c41a"
                                  : "#bfbfbf",
                            flexShrink: 0,
                          }}
                          icon={
                            status === "active" ? (
                              <LoadingOutlined spin />
                            ) : (
                              sa.icon
                            )
                          }
                        />
                      </Badge>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color:
                              status === "active"
                                ? sa.color
                                : status === "done"
                                  ? "#389e0d"
                                  : "#8c8c8c",
                          }}
                        >
                          {sa.label}
                        </div>
                        <div style={{ fontSize: 11, color: "#999" }}>
                          {status === "active"
                            ? "运行中"
                            : calls === 0
                              ? "未调用 (可能被跳过)"
                              : calls === 1
                                ? "已完成 ×1"
                                : `已重调 ×${calls}`}
                        </div>
                      </div>
                    </Space>
                  </Card>
                </Tooltip>
              </Col>
            );
          })}
        </Row>
      </Card>

      {/* 决策时刻面板 —— DeepAgent 自主性的核心证据 */}
      <Card
        size="small"
        title={
          <Space size={8}>
            <BulbOutlined style={{ color: "#fa8c16" }} />
            <span style={{ fontWeight: 600 }}>决策时刻 · agent 在每个十字路口的思考链路</span>
            <Badge count={decisions.length} style={{ backgroundColor: "#fa8c16" }} />
          </Space>
        }
        style={{ marginBottom: 12, borderColor: "#ffd591" }}
        styles={{ header: { background: "#fff7e6" }, body: { paddingTop: 8 } }}
      >
        {decisions.length === 0 ? (
          running ? (
            <div style={{ padding: "16px 0", textAlign: "center" }}>
              <Spin
                indicator={<LoadingOutlined spin />}
                tip="等待 agent 的第一个自主决策…"
              >
                <div style={{ height: 16 }} />
              </Spin>
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  agent 每次调用 record_decision 时，这里会按时间顺序追加一张决策卡，
                  让你看到它是基于什么信息做的判断。
                </Text>
              }
            />
          )
        ) : (
          <div className="decision-trail">
            {decisions.map((d, i) => (
              <DecisionCard key={i} index={i + 1} d={d} />
            ))}
          </div>
        )}
      </Card>

      {/* 输入区 */}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={6}>
          <Text>调研标的（产品 / 公司）</Text>
          <Input
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            style={{ marginTop: 4 }}
            placeholder="例如 Notion / Linear / Figma"
          />
        </Col>
        <Col xs={24} md={9}>
          <Text>预期读者</Text>
          <Input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            style={{ marginTop: 4 }}
          />
        </Col>
        <Col xs={24} md={9}>
          <Text>重点关注</Text>
          <Input
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            style={{ marginTop: 4 }}
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
              setProduct(p.product);
              setAudience(p.audience);
              setFocus(p.focus);
            }}
          >
            {p.label}
          </Tag>
        ))}
        {!running ? (
          <Button
            type="primary"
            icon={<RocketOutlined />}
            onClick={run}
            disabled={!product.trim()}
          >
            启动 DeepAgent 调研
          </Button>
        ) : (
          <Button danger icon={<LoadingOutlined />} onClick={stop}>
            运行中 · 点击中止
          </Button>
        )}
      </Space>

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ marginBottom: 12 }}
        />
      )}

      <Row gutter={16}>
        <Col xs={24} md={9}>
          {/* TODO 列表 */}
          <Card
            size="small"
            title={
              <Space>
                <FileTextOutlined />
                <span>规划工具 · TODO List</span>
                <Badge
                  count={todos.filter((t) => t.status === "completed").length}
                />
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
                    tip="主 Agent 正在调用 write_todos 拆解 8 步工作流…"
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
                          color:
                            t.status === "completed" ? "#9ca3af" : undefined,
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

          {/* 文件系统 */}
          <Card
            size="small"
            title={
              <Space>
                <FileTextOutlined />
                <span>文件系统 · {fileItems.length} 个交付物</span>
                <Badge count={fileItems.length} />
              </Space>
            }
          >
            {fileItems.length === 0 ? (
              running ? (
                <div style={{ padding: "24px 0", textAlign: "center" }}>
                  <Spin
                    indicator={<LoadingOutlined spin />}
                    tip="子 agent 还在工作中，文件即将陆续出现…"
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
                  label: <FileLabel name={name} />,
                  children: (
                    <pre
                      style={{
                        maxHeight: 420,
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
                <AuditOutlined />
                <span>Agent 活动流</span>
                {running && <Tag color="processing">运行中</Tag>}
                {done && <Tag color="success">已完成</Tag>}
                <Text type="secondary" style={{ fontSize: 12 }}>
                  共 {log.length} 条事件
                </Text>
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
                  description="点击「启动 DeepAgent 调研」后这里会实时打印工具调用与子 Agent 委派"
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

function FileLabel({ name }: { name: string }) {
  const isFinal = name.includes("final");
  return (
    <Space size={4}>
      <FileTextOutlined style={{ color: isFinal ? "#52c41a" : undefined }} />
      <span style={{ fontWeight: isFinal ? 600 : 400 }}>{name}</span>
      {isFinal && <Tag color="green">final</Tag>}
    </Space>
  );
}

function DecisionCard({ index, d }: { index: number; d: Decision }) {
  const confColor =
    d.confidence === "high"
      ? "green"
      : d.confidence === "medium"
        ? "gold"
        : "red";
  const time = new Date(d.ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (
    <div
      style={{
        borderLeft: "3px solid #fa8c16",
        background: "#fffbe6",
        padding: "10px 12px",
        marginBottom: 10,
        borderRadius: "0 6px 6px 0",
      }}
    >
      <Space size={6} style={{ marginBottom: 6 }}>
        <Tag color="orange">#{index}</Tag>
        <Tag>{d.who}</Tag>
        <Tag color={confColor}>置信度 {d.confidence}</Tag>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {time}
        </Text>
      </Space>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        <div>
          <Text strong style={{ color: "#874d00" }}>
            面对：
          </Text>
          {d.situation}
        </div>
        {d.options.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <Text strong style={{ color: "#874d00" }}>
              在权衡：
            </Text>
            {d.options.map((o, i) => (
              <Tag
                key={i}
                color={o === d.choice ? "orange" : "default"}
                style={{ marginRight: 4 }}
              >
                {o === d.choice ? "✓ " : ""}
                {o}
              </Tag>
            ))}
          </div>
        )}
        <div style={{ marginTop: 4 }}>
          <Text strong style={{ color: "#d4380d" }}>
            决定：
          </Text>
          {d.choice}
        </div>
        <div style={{ marginTop: 4 }}>
          <Text strong style={{ color: "#874d00" }}>
            理由：
          </Text>
          <Text type="secondary">{d.reason}</Text>
        </div>
      </div>
    </div>
  );
}

function toneOfTool(name: string): LogEntry["tone"] {
  switch (name) {
    case "task":
      return "purple";
    case "write_todos":
      return "blue";
    case "write_file":
      return "green";
    case "read_file":
      return "default";
    case "knowledge_lookup":
    case "compute_metric":
      return "gold";
    case "record_decision":
      return "magenta";
    default:
      return "default";
  }
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
