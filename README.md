# next-agent · LangChain / LangGraph / DeepAgent 三 demo 对比

一个用于分享的 **Next.js + Ant Design** 演示项目，把 LangChain 生态里的三个核心抽象层级用最简练的代码各自做了一个小 demo，
方便观众一眼看出它们各自最擅长什么、谁是谁的超集。

| Tab | 框架 | 凸显特性 | 演示主题 |
| --- | --- | --- | --- |
| 1 | **LangChain** (LCEL) | 极简串行流水线 + 题量可配 + 上下文传递 + 结构化输出 | 串行面试官（profile → angles → N 轮 Q→A→S → 决策，N 默认 3） |
| 2 | **LangGraph** | StateGraph、双 Agent 独立状态、条件边循环、节点级流式 | 红蓝队辩论赛（多轮反驳 → 逐轮判分 → 终局判决） |
| 3 | **DeepAgent** | 自主规划 / 自主路由 / 自主迭代 / 自我反思（开放式 prompt + record_decision 外化判断） | 竞品调研报告代理（agent 自己决定调谁 / 跳过谁 / 重调几次） |

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
   demo 切成「画像 → 考察角度 → N 轮 Q→A→S → 决策」的**完全串行**流水线（题量 N 前端可配 1-5）。
   每个 Runnable 只做一件极简的事、schema 只 1-2 个字段，前段输出直接喂给后段。
   作答时把所有历史问答喂回去，出题时把已出过题目喂回去——LCEL「前段输出=后段输入」的灵魂所在。
   横向 Steps 进度条让"链路一段一段亮起来"非常直观，N=3 时一共 12 个可观察 LLM 调用。
2. **LangGraph**：定位是"状态机引擎"，是 LangChain 之上、更接近真实 agent 控制流的一层。
   重点演示：红蓝队各自维护独立的状态线，`red_argue → blue_argue → judge → decide` 形成循环，
   `decide` 是真正的条件边——未到终轮回到 `red_argue`，到了就走 `verdict` 出最终判决。
   每轮内容因为「咬」对方上一轮的具体论点而真正发散，不会出现「每轮内容大同小异」的反思 demo 通病。
3. **DeepAgent**：定位是"开箱即用的复杂 agent harness"。这版 demo 是「**自主决策版竞品调研代理**」——
   SYSTEM_PROMPT 故意**没有「第一步、第二步」的脚本**，只给目标 / 资源 / 价值观 / 十字路口；
   agent 自己决定要调哪几个 sub-agent / 跳过谁 / fact-check 后是修订还是重调，且每个分叉点必须用 `record_decision` 把判断外化。
   重点演示：① 「决策时刻」面板按时间轴展开 agent 的思考链路；② sub-agent 卡片上的 `×2` Badge 表示该专家被 agent 决定重调（质量驱动循环）；③ 显示「未调用 (可能被跳过)」的卡说明 agent 主动跳过；④ `fact-check 轮数 × N` Tag 显示真实的迭代次数。

## License

MIT
