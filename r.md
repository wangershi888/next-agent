# 你是一个十年开发经验的前端工程师

现在需要你使用next typescript antd 搭建一个多tab页面的项目

其中，每个tab对应一个完整的agent demo 项目

需要你结合当前项目背景，搭建合适的项目结构

第一个tab：使用langchain(只使用langchain)搭建一个对话系统（形式类似于deepseek的对话页面）

langchain的文档：https://docs.langchain.com/oss/javascript/langchain/overview
需要使用到的api：createAget、 tool （此处只添加tavily联网搜索即可，可以在页面中有开关设置开启状态）、memory（需要记录对话上下文）

要求第一个tab只使用langchain创建

llm 模型使用千问，具体的apikey放在.env文件中进行配置