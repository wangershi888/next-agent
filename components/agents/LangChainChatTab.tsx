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
  Typography,
  theme,
} from "antd";
import type { UiChatMessage } from "@/lib/types/chat";

const { Text } = Typography;

export function LangChainChatTab() {
  const { token } = theme.useToken();
  const [messages, setMessages] = useState<UiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [enableWebSearch, setEnableWebSearch] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const transcriptMessages = useMemo(
    () =>
      messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    [messages],
  );

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: UiChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    setInput("");
    setError(null);
    setLoading(true);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "" },
    ]);

    requestAnimationFrame(scrollToBottom);

    try {
      const payloadMessages = [...transcriptMessages, { role: "user" as const, content: text }];

      const res = await fetch("/api/agents/langchain-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: payloadMessages,
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

          let evt: { type?: string; text?: string; message?: string; hint?: string };
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
          } else if (evt.type === "tool") {
            const hint = evt.hint ?? "tool";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content:
                        m.content +
                        (m.content.endsWith("\n") ? "" : "\n") +
                        `[调用工具：${hint}]\n`,
                    }
                  : m,
              ),
            );
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
      scrollToBottom();
    }
  };

  const onNewChat = () => {
    setMessages([]);
    setError(null);
    setInput("");
  };

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
      <Flex
        vertical
        style={{
          height: "100%",
          background: "var(--chat-bg)",
        }}
      >
        <Flex
          justify="space-between"
          align="center"
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--chat-border)",
            background: "var(--chat-surface)",
          }}
        >
          <Space>
            <Text strong>LangChain 对话</Text>
          </Space>
          <Space>
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
              <Text type="secondary">开始对话（布局参考对话类产品：主区域 + 底部输入）</Text>
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
            position: "sticky",
            bottom: 0,
            padding: "12px 16px 16px",
            background: "linear-gradient(180deg, transparent, var(--chat-bg) 12%)",
            borderTop: "1px solid var(--chat-border)",
          }}
        >
          <Space.Compact style={{ width: "100%" }} direction="vertical" size="small">
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入消息，Enter 发送（Shift+Enter 换行）"
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
      </Flex>
    </Layout>
  );
}
