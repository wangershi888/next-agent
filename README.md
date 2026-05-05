# next-agent · LangChain / LangGraph / DeepAgent 三 demo 对比

一个用于分享的 **Next.js + Ant Design** 演示项目，把 LangChain 生态里的三个核心抽象层级用最简练的代码各自做了一个小 demo，
方便观众一眼看出它们各自最擅长什么、谁是谁的超集。

| Tab | 框架 | 凸显特性 | 演示主题 |
| --- | --- | --- | --- |
| 1 | **LangChain** (LCEL) | Prompt → LLM → Parser 的 `.pipe()` 链式组合，结构化输出 | 电影推荐 |
| 2 | **LangGraph** | StateGraph、条件边形成循环、节点级流式 | 反思式短文写作（带评分循环） |
| 3 | **DeepAgent** | 规划工具 + 子 Agent + 文件系统 + 详细 System Prompt | 多智能体旅行规划师 |

## 目录结构

```
.
├── app/                       # Next.js App Router 入口
│   ├── layout.tsx
│   ├── page.tsx               # 主页 (Ant Design Tabs)
│   ├── globals.css
│   └── api/
│       ├── langchain/route.ts # demo 1 接口
│       ├── langgraph/route.ts # demo 2 SSE 流式接口
│       └── deepagent/route.ts # demo 3 SSE 流式接口
├── components/                # 客户端组件
│   ├── HomeTabs.tsx
│   ├── LangChainDemo.tsx
│   ├── LangGraphDemo.tsx
│   └── DeepAgentDemo.tsx
├── frameworks/                # 三个 demo 的「框架代码」各自隔离
│   ├── langchain/             #   - LCEL 链
│   │   ├── chain.ts
│   │   └── README.md
│   ├── langgraph/             #   - StateGraph 反思图
│   │   ├── graph.ts
│   │   └── README.md
│   └── deepagent/             #   - 多智能体规划
│       ├── agent.ts
│       └── README.md
├── package.json
├── tsconfig.json
├── next.config.mjs
├── .env.local.example         # 把它复制成 .env.local 并填上 DEEPSEEK_API_KEY
└── re.md                      # 原始需求
```

每个框架的核心实现都放在 `frameworks/<name>/` 下，**互不依赖**，可以单独抽走复用。
对应的 README 解释了该 demo 的关键代码与演示要点，分享时可以直接打开对照讲解。

## 运行

> ⚠️ 项目里的依赖**没有自动安装**，请手动执行下面命令安装。

```bash
# 1. 安装依赖
npm install
# 或 pnpm install / yarn

# 2. 配置 DeepSeek API Key
cp .env.local.example .env.local
# 然后把里面的 DEEPSEEK_API_KEY 替换成你自己的

# 3. 启动
npm run dev
# 浏览器打开 http://localhost:3000
```

模型用的是最新的 DeepSeek V4，**统一在 `.env.local` 配置**，三个 demo 不再硬编码：

| 环境变量 | 默认值 | 谁在用 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 必填 | 三个 demo 都要 |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | LangChain demo / LangGraph demo（routine 推理） |
| `DEEPSEEK_MODEL_PRO` | `deepseek-v4-pro` | DeepAgent demo（需要 tool calling + 长链路推理） |
| `DEEPSEEK_API_BASE` | 留空走官方端点 | 自建 / 代理 / 国产兼容服务时填 |

切换模型只改一份 `.env.local` 即可，不用动代码。
如果想换成 OpenAI / Anthropic 等其它供应商，再去各 `frameworks/*/` 里替换 `buildModel()` 即可。

## 三个 demo 的演讲口径建议

1. **LangChain (LCEL)**：定位是"组件库 + 编排原语"，主打 `.pipe()` 串联。
   适合做一次性、线性的链式任务。看演示时重点指出：左上角的 `Prompt | LLM | Parser` 流水线、右侧 3 张电影卡片是 Zod 强类型解析出来的。
2. **LangGraph**：定位是"状态机引擎"，是 LangChain 之上、更接近真实 agent 控制流的一层。
   重点演示：`generate ↔ critique` 循环，分数没到目标就回到生成节点；右侧的步骤条 + 多张迭代卡片说明状态在每轮都在累计。
3. **DeepAgent**：定位是"开箱即用的复杂 agent harness"，是 LangGraph 之上的更高层抽象。
   把"规划工具 / 子 Agent / 文件系统 / 详细系统提示"四件套打包好，让你专注业务而不用自己写循环。
   重点演示：左侧 TODO 面板自我更新、活动流里出现紫色 `task(...)` 时是子 Agent 接管、最后 `trip-plan.md` 出现在文件面板。

## License

MIT
