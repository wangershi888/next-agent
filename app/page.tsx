import HomeTabs from "@/components/HomeTabs";

export default function Page() {
  return (
    <div className="page-wrap">
      <header className="page-header">
        <h1>Agent 框架对比 · LangChain / LangGraph / DeepAgent</h1>
        <p>
          基于 Next.js + Ant Design + DeepSeek，三个独立 demo 凸显每个框架的核心特性。
          切换下方 Tab 即可体验。
        </p>
      </header>
      <HomeTabs />
    </div>
  );
}
