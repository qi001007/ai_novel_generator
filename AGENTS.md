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
## Figma / MCP 故障分流（2026-09-02 取证定稿）

任何"某工具不在了 / MCP 掉了"的判断，必须先走本节流程。禁止凭单次报错直接下结论。

### 1. 按报错串分流——三类错误含义完全不同，不许混用

| 你看到的报错 | 真实含义 | 正确动作 |
|---|---|---|
| `unsupported call: <name>` | **工具名解析失败**。最常见是漏了 MCP 命名空间前缀（写 `use_figma` 而实际是 `mcp__figma__use_figma`），或该名字来自别的 harness（`write_file` / `read_files` 在本环境不存在） | 用全名重试；全名仍失败才可以判定"不存在" |
| JSON 报错含 `at <anonymous> (PLUGIN_N_SOURCE:…)` 与 `Figma Debug UUID` | **工具在正常执行**，是你的脚本违反 Figma Plugin API | 改脚本，不要怀疑工具面 |
| `You've reached the Figma MCP tool call limit on the … plan` | 服务端**额度**，与工具面无关。`use_figma` / `create_new_file` / `add_code_connect_map` / `whoami` 属写类或豁免额度 | 查文件归属空间与席位；不要改成"绕道像素取色" |

取证基线（`~/.codex/thread_history_1.sqlite` + `logs_2.sqlite`，2026-09-02）：
`use_figma` 结构化工具调用共 289 次派发 = 238 成功 / 51 服务端真报错 / **0 次派发失败**；
Codex 判定 `MCP server tools unavailable` 的对象只有 `mineru`(21) / `github`(18) / `codex_apps`(1)，
**`figma` 从未上榜**。历史上所有"use_figma 不存在"的字样都在模型自己的 reasoning / agentMessage 里，
以及 `read_mcp_resource` 读回来的官方文档正文里，不在任何一条工具调用记录里。

### 2. 活体探针只用 `mcp__figma__whoami`

约 300ms 返回、payload 最小、且属额度豁免工具。

**禁止**用 `list_mcp_resources` / `list_mcp_resource_templates` 判断 MCP 是否健康：
它们读的是启动期缓存的工具/schema 快照，工具全部不可用时照样返回全量列表，是假阳性来源。

### 3. `read_mcp_resource` 读来的排障文档只能当"待验证假设"

Figma 官方 `tools-not-loading.md` / `code-to-canvas.md` 含原句
"The `use_figma` or `generate_figma_design` tool isn't available"，
但其成立条件是"**同时**配置了 desktop server `http://127.0.0.1:3845/mcp` 并遮蔽了远程 server"。
本机实测：3845 无监听、`.codex` 全目录无 `3845` 配置、Figma 经插件 `figma@openai-api-curated`
指向 `https://mcp.figma.com/mcp`，条件不成立。

引用排障文档必须连同其成立条件整句引用；上下文压缩后只保留结论视为错误陈述。

### 4. 本环境真实的抖动只在**参数层**，不在工具存在层

`failed to parse function arguments: invalid type: null, expected u64`、
`expected number, received string`、`apply_patch` 序列化失败属同一类：
经本地 provider shim 时参数类型退化。处置 = 重发，或改用 here-string / 临时脚本落地。
这类报错**不能**作为"工具面在掉"的证据。

### 5. 真正需要修的两件事（别再重复排查）

- `github` MCP 的 `AuthRequired: Token is not authorized`（11 次）＝ PAT 过期，需换新 token。
- Figma 导出图下载在沙箱内直连超时，须 `sandbox_permissions=require_escalated` +
  `$env:HTTPS_PROXY="http://127.0.0.1:7890"`。

</INSTRUCTIONS>
