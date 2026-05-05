"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  Row,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { SendOutlined, RightOutlined } from "@ant-design/icons";

const { Title, Paragraph, Text } = Typography;
const { TextArea } = Input;

type Movie = {
  title: string;
  year: number;
  genre: string;
  description: string;
  why_recommended: string;
};

type Recommendation = {
  movies: Movie[];
  summary: string;
};

const PRESETS = [
  "周五下班，想找一部又燃又解压的片子",
  "下雨天独自在家，想哭一场",
  "和初恋复合的第一晚约会",
];

export default function LangChainDemo() {
  const [mood, setMood] = useState(PRESETS[0]);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Recommendation | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const resp = await fetch("/api/langchain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood }),
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || "请求失败");
      setData(json.data);
    } catch (err) {
      const m = err instanceof Error ? err.message : "请求失败";
      setError(m);
      message.error(m);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="demo-card">
      <Title level={4} style={{ marginTop: 0 }}>
        电影推荐 · LCEL 经典三件套
      </Title>
      <Paragraph type="secondary" style={{ marginTop: -4 }}>
        本 demo 用最经典的 LangChain Expression Language 把
        <Text code>PromptTemplate</Text> 、<Text code>ChatModel</Text> 、
        <Text code>StructuredOutputParser</Text>
        三个 Runnable 用 <Text code>.pipe()</Text> 串起来，体现 LangChain 「可组合」的核心思想。
      </Paragraph>

      <div className="flow-pipeline" style={{ marginBottom: 16 }}>
        <Tag color="blue">ChatPromptTemplate</Tag>
        <RightOutlined className="flow-arrow" />
        <Tag color="purple">ChatDeepSeek</Tag>
        <RightOutlined className="flow-arrow" />
        <Tag color="green">withStructuredOutput(Zod)</Tag>
      </div>

      <Space.Compact style={{ width: "100%", marginBottom: 12 }}>
        <TextArea
          rows={2}
          value={mood}
          onChange={(e) => setMood(e.target.value)}
          placeholder="描述你现在的心情或场景..."
        />
      </Space.Compact>
      <Space wrap style={{ marginBottom: 16 }}>
        {PRESETS.map((p) => (
          <Tag
            key={p}
            color="blue"
            style={{ cursor: "pointer" }}
            onClick={() => setMood(p)}
          >
            {p}
          </Tag>
        ))}
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={run}
          loading={loading}
          disabled={!mood.trim()}
        >
          运行 LCEL 链
        </Button>
      </Space>

      {error && (
        <Alert type="error" showIcon message={error} style={{ marginTop: 8 }} />
      )}

      {data && (
        <>
          <Alert
            type="success"
            showIcon
            message="结构化输出成功"
            description={data.summary}
            style={{ marginBottom: 16 }}
          />
          <Row gutter={[16, 16]}>
            {data.movies.map((m, i) => (
              <Col xs={24} md={8} key={i}>
                <Card
                  title={
                    <Space>
                      <Text strong>{m.title}</Text>
                      <Tag color="gold">{m.year}</Tag>
                    </Space>
                  }
                  size="small"
                >
                  <Tag color="cyan" style={{ marginBottom: 8 }}>
                    {m.genre}
                  </Tag>
                  <Paragraph style={{ marginBottom: 8 }}>
                    {m.description}
                  </Paragraph>
                  <Paragraph type="secondary" style={{ margin: 0 }}>
                    💡 {m.why_recommended}
                  </Paragraph>
                </Card>
              </Col>
            ))}
          </Row>
        </>
      )}
    </div>
  );
}
