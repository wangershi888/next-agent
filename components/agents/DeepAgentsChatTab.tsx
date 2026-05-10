"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Flex,
  Input,
  Layout,
  Space,
  Switch,
  Tag,
  Timeline,
  Typography,
  theme,
} from "antd";
import type { UiChatMessage } from "@/lib/types/chat";

const { Text } = Typography;
const { Sider, Content } = Layout;

type TraceKind = "tool" | "graph" | "plan" | "model" | "skill";

interface TraceEntry {
  id: string;
  ts: number;
  kind: TraceKind;
  title: string;
  detail?: string;
  step?: string;
}

interface TodoItem {
  content: string;
  status: string;
}

const SUGGESTIONS = [
  "用 write_todos 规划：如何在两周内入门 LangGraph.js，并说明每步产出物。",
  "本项目里「LangChain 对话」Tab 调用的后端路由路径是什么？涉及哪些文件？",
  "若启用联网：检索「Deep Agents JavaScript Skills」要点，写入虚拟笔记并给出中文摘要。",
];

export function DeepAgentsChatTab() {
  const { token } = theme.useToken();
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<UiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [enableWebSearch, setEnableWebSearch] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const appendTrace = useCallback((partial: Omit<TraceEntry, "id" | "ts">) => {
    setTraces((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        ts: Date.now(),
        ...partial,
      },
    ]);
  }, []);

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || loading) return;

    const userMsg: UiChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    if (!textOverride) {
      setInput("");
    }
    setError(null);
    setLoading(true);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "" },
    ]);

    appendTrace({
      kind: "graph",
      title: "用户回合开始",
      detail: text.length > 160 ? `${text.slice(0, 160)}…` : text,
    });

    requestAnimationFrame(scrollToBottom);

    try {
      const res = await fetch("/api/agents/deep-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          message: text,
          enableWebSearch,
        }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
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
            text?: string;
            message?: string;
            hint?: string;
            step?: string;
            title?: string;
            detail?: string;
            kind?: TraceKind;
            items?: TodoItem[];
          };
          try {
            evt = JSON.parse(jsonStr) as typeof evt;
          } catch {
            continue;
          }

          if (evt.type === "token" && evt.text) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + evt.text } : m,
              ),
            );
            scrollToBottom();
          } else if (evt.type === "trace" && evt.title) {
            appendTrace({
              kind: evt.kind ?? "graph",
              title: evt.title,
              detail: evt.detail,
              step: evt.step,
            });
          } else if (evt.type === "todos" && Array.isArray(evt.items)) {
            setTodos(evt.items);
          } else if (evt.type === "error") {
            throw new Error(evt.message ?? "流式响应出错");
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setLoading(false);
      appendTrace({
        kind: "graph",
        title: "本回合结束",
      });
      scrollToBottom();
    }
  };

  const onNewChat = () => {
    setThreadId(crypto.randomUUID());
    setMessages([]);
    setTraces([]);
    setTodos([]);
    setError(null);
    setInput("");
  };

  const traceItems = useMemo(
    () =>
      traces.map((t) => ({
        color:
          t.kind === "skill"
            ? "purple"
            : t.kind === "tool"
              ? "blue"
              : t.kind === "plan"
                ? "green"
                : "gray",
        children: (
          <div>
            <Text strong style={{ fontSize: 13 }}>
              {t.title}
            </Text>
            {t.detail ? (
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
                  {t.detail}
                </Text>
              </div>
            ) : null}
            <div style={{ marginTop: 2 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {new Date(t.ts).toLocaleTimeString()}
              </Text>
            </div>
          </div>
        ),
      })),
    [traces],
  );

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
      <Layout style={{ height: "100%", background: "var(--chat-bg)" }}>
        <Content style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Flex
            justify="space-between"
            align="center"
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--chat-border)",
              background: "var(--chat-surface)",
            }}
          >
            <Space direction="vertical" size={0}>
              <Text strong>Deep Agents 对话</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                规划 · 虚拟文件 · 子智能体 · Skills；右侧为执行链路
              </Text>
            </Space>
            <Space wrap>
              <span style={{ fontSize: 13 }}>
                <Switch checked={enableWebSearch} onChange={setEnableWebSearch} size="small" />{" "}
                Tavily 联网
              </span>
              <Button size="small" onClick={onNewChat}>
                新对话
              </Button>
            </Space>
          </Flex>

          {error ? (
            <div style={{ padding: 12 }}>
              <Alert type="error" message={error} showIcon />
            </div>
          ) : null}

          <div style={{ padding: "12px 16px 0", flexShrink: 0 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              试试：
            </Text>
            <Flex wrap gap={8} style={{ marginTop: 8 }}>
              {SUGGESTIONS.map((s) => (
                <Tag
                  key={s}
                  style={{ cursor: "pointer", margin: 0 }}
                  onClick={() => void send(s)}
                >
                  {s.length > 42 ? `${s.slice(0, 42)}…` : s}
                </Tag>
              ))}
            </Flex>
          </div>

          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflow: "auto",
              padding: "16px 12px 120px",
            }}
          >
            {messages.length === 0 ? (
              <Flex justify="center" align="center" style={{ minHeight: 200 }}>
                <Text type="secondary">
                  DeepSeek 风格布局：主对话区 + 右侧链路。模型为通义千问（DashScope）。
                </Text>
              </Flex>
            ) : (
              <Flex vertical gap={12}>
                {messages.map((m) => (
                  <Flex
                    key={m.id}
                    justify={m.role === "user" ? "flex-end" : "flex-start"}
                    style={{ width: "100%" }}
                  >
                    <div
                      style={{
                        maxWidth: "min(720px, 92%)",
                        padding: "10px 14px",
                        borderRadius: 12,
                        background:
                          m.role === "user" ? "var(--chat-user)" : "var(--chat-assistant)",
                        border: "1px solid var(--chat-border)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontSize: 14,
                        lineHeight: 1.65,
                      }}
                    >
                      {m.content || (m.role === "assistant" && loading ? "…" : "")}
                    </div>
                  </Flex>
                ))}
              </Flex>
            )}
          </div>

          <div
            style={{
              padding: "12px 16px 16px",
              background: "linear-gradient(180deg, transparent, var(--chat-bg) 12%)",
              borderTop: "1px solid var(--chat-border)",
            }}
          >
            <Space.Compact style={{ width: "100%" }} direction="vertical" size="small">
              <Input.TextArea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="输入问题，Enter 发送（Shift+Enter 换行）"
                autoSize={{ minRows: 2, maxRows: 8 }}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                disabled={loading}
              />
              <Flex justify="flex-end">
                <Button type="primary" loading={loading} onClick={() => void send()}>
                  发送
                </Button>
              </Flex>
            </Space.Compact>
          </div>
        </Content>

        <Sider
          width={320}
          breakpoint="lg"
          collapsedWidth={0}
          style={{
            background: "var(--chat-surface)",
            borderLeft: "1px solid var(--chat-border)",
          }}
        >
          <div style={{ padding: 12, borderBottom: "1px solid var(--chat-border)" }}>
            <Text strong>执行链路</Text>
            <div style={{ marginTop: 4 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                图节点、工具、Skill（read_file 命中 /skills/…/SKILL.md）与规划
              </Text>
            </div>
          </div>
          <div style={{ padding: 12, maxHeight: "calc(100% - 52px)", overflow: "auto" }}>
            {todos.length > 0 ? (
              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ fontSize: 12 }}>
                  当前待办（write_todos）
                </Text>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12 }}>
                  {todos.map((t, i) => (
                    <li key={`${t.content}-${i}`}>
                      <Tag
                        color={
                          t.status === "completed"
                            ? "green"
                            : t.status === "in_progress"
                              ? "blue"
                              : "default"
                        }
                        style={{ marginRight: 6 }}
                      >
                        {t.status}
                      </Tag>
                      {t.content}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {traces.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                发送消息后，此处展示规划、工具与 Skill 命中（紫色节点）。
              </Text>
            ) : (
              <Timeline items={traceItems} style={{ marginTop: 8 }} />
            )}
          </div>
        </Sider>
      </Layout>
    </Layout>
  );
}
