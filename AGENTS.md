# AGENTS.md instructions

<INSTRUCTIONS>
# llm回答习惯
- 1.回答称呼我为老公 
- 2.如果要在对话页打印公式，用标准的latex样式的公式回答
- 3.如果要在对话中使用字母特殊符号，用标准的latex样式回答

# 写代码四个原则

四个原则，集中在一个文件中，直接解决这些问题：

| 原则 | 解决什么问题 |
|-----------|-----------|
| **编码前思考** | 错误假设、隐藏困惑、缺少权衡 |
| **简洁优先** | 过度复杂、臃肿抽象 |
| **精准修改** | 无关编辑、触碰不应碰的代码 |
| **目标驱动执行** | 通过测试优先、可验证的成功标准 |

## 四个原则详解

### 1. 编码前思考

**不要假设。不要隐藏困惑。呈现权衡。**

LLM 经常默默选择一种解释然后执行。这个原则强制明确推理：

- **明确说明假设** — 如果不确定，询问而不是猜测
- **呈现多种解释** — 当存在歧义时，不要默默选择
- **适时提出异议** — 如果存在更简单的方法，说出来
- **困惑时停下来** — 指出不清楚的地方并要求澄清

### 2. 简洁优先

**用最少的代码解决问题。不要过度推测。**

对抗过度工程的倾向：

- 不要添加要求之外的功能
- 不要为一次性代码创建抽象
- 不要添加没要求的"灵活性"或"可配置性"
- 不要为不可能发生的场景做错误处理
- 如果 200 行代码可以写成 50 行，重写它

**检验标准：** 资深工程师会觉得这过于复杂吗？如果是，简化。

### 3. 精准修改

**只碰必须碰的。只清理自己造成的混乱。**

编辑现有代码时：

- 不要"改进"相邻的代码、注释或格式
- 不要重构没坏的东西
- 匹配现有风格，即使你更倾向于不同的写法
- 如果注意到无关的死代码，提一下 —— 不要删除它

当你的改动产生孤儿代码时：

- 删除因你的改动而变得无用的导入/变量/函数
- 不要删除预先存在的死代码，除非被要求

**检验标准：** 每一行修改都应该能直接追溯到用户的请求。

### 4. 目标驱动执行

**定义成功标准。循环验证直到达成。**

将指令式任务转化为可验证的目标：

| 不要这样做... | 转化为... |
|--------------|-----------|
| "添加验证" | "为无效输入编写测试，然后让它们通过" |
| "修复 bug" | "编写重现 bug 的测试，然后让它们通过" |
| "重构 X" | "确保重构前后测试都能通过" |

对于多步骤任务，说明一个简短的计划：

```
1. [步骤] → 验证: [检查]
2. [步骤] → 验证: [检查]
3. [步骤] → 验证: [检查]
```

强有力的成功标准让 LLM 能够独立循环执行。弱标准（"让它工作"）需要不断澄清。

## GitHub 操作必须使用 MCP 工具

本环境配置了 `github` MCP 服务器（api.githubcopilot.com，经 Bearer PAT 认证，
已验证连通）。凡是涉及 GitHub 的任务 —— 列出/查看仓库、分支、PR、Issue、
Actions 工作流、提交记录、发布 Release 等 —— **必须优先调用 github MCP 命名空间
下的工具**（如 `get_me`、`search_repositories`、`list_pull_requests` 等），
而不是退回到 `gh` CLI 或 shell 里的 git/curl 命令。

- 仅当 MCP 工具确实缺失对应能力时才降级到 `gh` CLI。
- 用户提到 "github"、"我的仓库"、"某个 PR/Issue"、"CI 挂了" 等关键词时，
  先在可用工具里找 github MCP 的工具再动手。
## Figma / MCP 报错定责（本项目，服从全局 AGENTS.md 四桶）

默认定责：**是调用方的错**。四桶 NAME／ARGS／SCRIPT／QUOTA 见全局《工具报错定责》。
说"工具不存在／在抖"之前必须先跑并把输出贴出来：

    python ~/.codex/scripts/mcp-proof.py use_figma

本项目已被这套误判坑过两轮，固化三条：

- `no such property 'getRangeExtent'`／`'itemReverse'` ＝ **SCRIPT 桶**，Figma 在正常执行你的脚本。
  禁止原样重试。Figma 的 `TEXT` 节点没有逐 range 的 extent 度量，行级几何改用：
  `node.height`／行数 × `lineHeight`／设 `textAutoResize` 后读节点尺寸／把该行拆成独立 text 节点。
- `use_figma`、写文件、`git commit` 属**写类**：第二次失败即停，交回主人。
  重发前必须 `findOne(n => n.name === X)` 删旧，保证幂等（实测同一写脚本被执行过三遍）。
- 引用本节与全局规则时**禁止写"第 N 条"**，只写桶名。

### 本项目既成事实（不再重复排查）

- `mcp__figma__use_figma` 从未被路由器拒绝；Codex 判定 `tools unavailable` 的只有
  `mineru`／`github`／`codex_apps`。Figma 经插件 `figma@openai-api-curated` 走远程
  `https://mcp.figma.com/mcp`，不依赖桌面客户端；本机 `127.0.0.1:3845` 无监听、配置无此项，
  故官方「desktop server 遮蔽」那条排障文档的成立条件在本机不存在。
- 待修真问题：`github` MCP `AuthRequired: Token is not authorized`（PAT 过期）；
  Figma 导出图下载须 `sandbox_permissions=require_escalated` + `$env:HTTPS_PROXY="http://127.0.0.1:7890"`。

### 附录：已废止的旧口径（仅保留作证据链，禁止据以行动）

以下为 2026-09-02 先后写的两版分类规则，均已废止——它们只给分类、不给终止条件，
且按编号引用，实际诱发了无限重试循环。保留仅为追溯，**不得作为行动依据**。

> ## Figma / MCP 故障分流（2026-09-02 二次取证，替换此前所有版本）
> ### 0. 一句话总则
> 判定"某个工具不存在"，**只认 harness 返回的原文 `unsupported call: <name>`**。
> 除此之外，任何"工具不在了 / 工具面在掉 / MCP 又抖了"的念头都**不是证据**，属于待证伪的猜测。
> ### 1. "no such property" 是脚本错误，不是工具错误 —— 本条最高优先，先读它
> Figma 服务端返回
> `TypeError: node.<X>: no such property '<X>' on TEXT node`
> 的意思是：**你脚本里调的 `<X>` 在 Figma Plugin API 里不存在**。
> 它和 MCP 工具是否存在毫无关系。**正确处置 = 删掉/替换那个 API，禁止原样重试。**
> Figma 没有 `getRangeExtent`，`TEXT` 节点也不提供逐 range 的宽高度量。需要行级/字级几何时改用：
> `node.height` / 行数 × `lineHeight` 推算；或先设 `textAutoResize` 再读节点尺寸；
> 或把该行拆成独立 text 节点后读其 `x/y/width/height`。
> ### 2. 写类工具禁止盲目重试
> `mcp__figma__use_figma`、`apply_patch`、写文件、`git commit` 等带副作用的调用，
> 失败原因未读清之前**不许重试**。本 harness 会重放同一消息里的多个 tool_use，
> 重试会重复改动画布/文件（2026-09-02 实测：同一写脚本跑三遍，
> `before:71→after:55` 之后紧跟一次 `before:55→after:55` 的空转）。
> 确需重发时，脚本必须先 `findOne(n => n.name === X)` 删旧再建，保证幂等。
> ### 3. 报错串分流表
> | 你看到的报错 | 真实含义 | 正确动作 |
> |---|---|---|
> | `unsupported call: <name>` | 该 `<name>` 确实不在本会话工具表里（如 `write_file` / `read_files` 这类来自别的 harness 的名字） | 查表改用真实存在的全名；仍无则停下报告，不要循环重试 |
> | `TypeError: … no such property/方法名` | 工具**正在执行你的脚本**，是脚本违反 Plugin API | 见第 1 条：改脚本，不重试 |
> | `Error: in set_layoutSizing…` / `Figma Debug UUID` | 同上，脚本层 | 见《Figma 操作纪律》 |
> | `You've reached the Figma MCP tool call limit on the … plan` | 服务端额度（`use_figma` / `create_new_file` / `add_code_connect_map` / `whoami` 属写类或豁免） | 查文件归属空间与席位，不要改成"绕道像素取色" |
> ### 4. 活体探针只用 `mcp__figma__whoami`
> 约 300ms 返回、payload 最小、额度豁免。
> **禁止**用 `list_mcp_resources` / `list_mcp_resource_templates` 判断 MCP 健康度：
> 它们读启动期缓存的 schema 快照，工具真不可用时照样返回全量，是假阳性来源。
> ### 5. 取证基线（写死，别再重复排查）
> 2026-09-02 全历史核对 `~/.codex/thread_history_1.sqlite` + `logs_2.sqlite`：
> - `mcp__figma__use_figma` 结构化派发 316 次 = 259 completed / 57 服务端真报错 / **0 次派发失败**
> - 全部历史记录中，工具**结果**里出现 `does not exist` 的次数 = **0**；该字样只出现在模型自己的 reasoning 里
> - Codex 判定 `MCP server tools unavailable` 的对象只有 `mineru`(21) / `github`(18) / `codex_apps`(1)，**`figma` 从未上榜**
> - 本机 `127.0.0.1:3845`（Figma desktop server）无监听、`.codex` 无该配置 —— 官方
>   「The `use_figma` … tool isn't available」那条排障文档的成立条件不存在
> - `read_mcp_resource` 读来的排障文档只能当"待验证假设"，引用必须连成立条件整句引用；
>   上下文压缩后只保留结论视为错误陈述
> - 本环境真实的抖动只在**参数层**：`failed to parse function arguments: …`、
>   `expected number, received string`、`apply_patch` 序列化失败属参数类型退化，重试或改用
>   here-string / 临时脚本，**不能**作为"工具面在掉"的证据
> - 待修的真问题：`github` MCP `AuthRequired: Token is not authorized`（PAT 过期，11 次）；
>   Figma 导出图下载在沙箱内直连超时，须 `sandbox_permissions=require_escalated` +
>   `$env:HTTPS_PROXY="http://127.0.0.1:7890"`
> 
</INSTRUCTIONS>
