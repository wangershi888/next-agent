# LangChain Demo · 电影推荐 (LCEL)

这个 demo 用最经典的 **LangChain Expression Language (LCEL)** 把三个 Runnable 串起来，
展示 LangChain "万物皆可 pipe" 的设计哲学。

```
ChatPromptTemplate ──▶ ChatDeepSeek ──▶ withStructuredOutput(Zod)
```

## 关键代码

```ts
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "你是一位资深影评人..."],
  ["human", "我此刻的心情/场景：{mood}\n请用结构化方式给我推荐"],
]);

const llm = new ChatDeepSeek({ model: "deepseek-v4-flash" })
  .withStructuredOutput(RecommendationSchema);

// LCEL: 用 .pipe() 把可运行单元拼成一条链
const chain = prompt.pipe(llm);

const result = await chain.invoke({ mood: "下雨天想哭一场" });
//   ^ TypeScript 直接拿到强类型 { movies: Movie[], summary: string }
```

## 演示要点

- **Prompt 模板化**：`{mood}` 参数化，复用同一条提示。
- **链式组合**：`prompt.pipe(llm)` 之后整条链本身仍是 Runnable，可继续 `.pipe(...)` 接 retriever / parser / 自定义函数。
- **结构化输出**：`withStructuredOutput` 用 Zod schema 直接得到强类型 JSON，无需手写 JSON 解析。

## 涉及文件

- [`chain.ts`](./chain.ts) —— 链定义
- `app/api/langchain/route.ts` —— Next.js Route Handler
- `components/LangChainDemo.tsx` —— 前端 UI
