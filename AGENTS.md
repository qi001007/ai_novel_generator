# AGENTS.md instructions

<INSTRUCTIONS>
# llm回答习惯
- 1.回答称呼我为主人 
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

# UI 批注处理闭环（主人的行为逻辑，2026-09-05 明确要求写进本文件）

主人原话：「你先把这些记录到文档里，再根据文档一个一个更改」「把做完的删掉」
「按照这个行为逻辑先写进文件里，然后一步一步实践、勾画，最后交给我审核」。
这不是建议，是每一批界面批注的**唯一合法流程**；跳步＝返工，历史上每次都返工了。

| 步 | 动作 | 硬约束 |
|---|---|---|
| **0** | 主人提的**任何**新东西，当场写进 `docs/UI-BACKLOG.md` 当前批次，**一条都不留在对话里** | 每条必须带**判据**（怎么算做完，最好是可测量的数字）。落不进文件＝没提 |
| **1** | 按**严重度**排序做，不按清单编号；一次只做一条 | 「同时开始处理前几轮任务」= 本批做完后接第四节，**不是**几条混进一个提交 |
| **2** | 效果类改动**必须真机截图、自己看过** | 只看 diff 不算做完。取证通道见《前端取证通道》；**效果类 bug 一律先量再改** |
| **3** | 改界面 = 同一个提交里改 `frontend/src/uiInvariants.test.ts` 断言 | 断言随决定搬家，**不许删断言**；决定被推翻才改其内容，并写明是哪一批推的 |
| **4** | 同步文档四件套：`UI-BACKLOG` 勾项（带实测数字）→ `UI-DESIGN §0.9` → `WORKSTREAM-PLAN` 一行结论 → `DECISIONS`（若有理由/裁定） | 各管一段，别往一处堆 |
| **5** | **每条单独 commit + 单独 push**，不许攒到最后 | commit message 写清是哪条批注、**责任提交是谁**（是我自己上一轮造的，必须明写哈希） |
| **6** | 做完的条目**从 `UI-BACKLOG.md` 里删掉**（文件标题就是「勾完即删该条」），结论只留在 `WORKSTREAM-PLAN` 历史表一行 | 勾了不删＝下一个人无法区分待办与已办；未结项**一条都不许丢**，精简时逐条搬走 |
| **7** | 跑全部门禁再推：后端 pytest／前端 vitest／`tsc -b --force`／`npm run build`／命中区审计 | 期望值写在 `UI-BACKLOG` 第七节，变了要写为什么变 |
| **8** | 整批做完 → **交主人审核**：逐条列出改了什么＋实测数字＋提交哈希，再列我没动的项 | 不许用「测试全绿」顶替「功能已实现」 |

两条补充（都是踩出来的）：

- **顺手发现的别的缺陷：只登记，不顺手改**（工作规则 2）。登记成 `16.10`／`16.11` 这种
  带「责任提交」的条目，标清「本轮不做」，等主人点头或单独一条做。
- **主人在工作树里手改过文件时，先核实他的批注再动手，绝不覆盖。**
  2026-09-05 他直接在 `UI-BACKLOG.md` 里把一条改成「这个好像已经完成了」——
  这种批注是要我去**查证**（量一遍），不是当成已完成的声明照抄。

## GitHub 操作必须使用 MCP 工具

本环境配置了 `github` MCP 服务器（api.githubcopilot.com，经 Bearer PAT 认证，
PAT 已过期，见《本项目既成事实》待修项，调用前先确认凭据有效）。凡是涉及 GitHub 的任务 —— 列出/查看仓库、分支、PR、Issue、
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

## 项目架构红线（违反即错，不需要解释）

完整依据在 `docs/DECISIONS.md`，括号里是编号。

- **四层规划只有一条写入口**：`PUT /api/novels/{id}/files/{path}`。`/planning/*` 只读，写请求一律 410；
  新建章节与简报也走同一条文件层 `PUT`，禁止任何形式开第二条写通路（D-01）。DB 是唯一真源，
  `chapters/NNNN/{draft.md,brief.md}` 是投影（D-02 / D-03）。
- **上下文注入只有一个构造器**：`collect_items()` 是唯一资料池。改注入内容只改对应 collector，
  不改调用方、不改提示词模板、不改前端（D-04 / D-06）。
- **不许把「测试全绿」说成「功能已实现」**。对话 Agent 至今无工具调用、无联网搜索、无多步循环；
  谈 Agent 能力前先 grep 取证（ARCHITECTURE §4 缺口清单）。
- **不摘前端做独立 demo**：网络边界已在 `api.ts` 单点，要脱离后端就在同接口下加 fixture 实现（D-07）。
- **v1 不做向量 RAG**：唯一合法前置是一次可复现的「该给的章节没给」（D-12）。
- **文档各管一段，别往一处堆**：理由→DECISIONS，现状→ARCHITECTURE，需求→PRD/REQUIREMENTS，
  视觉→UI-DESIGN，进度→WORKSTREAM-PLAN，入口→HANDOFF（DECISIONS §6）。

### 前端取证通道（2026-09-03 实测可用，优先于猜）

本机无 Chrome、`chrome_devtools` MCP 不可用，但裸 Edge + CDP 完全可用，且能真实点击与拖拽：

    $edge='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    Start-Process $edge -WindowStyle Hidden -ArgumentList '--headless','--no-sandbox',
      '--disable-gpu','--remote-debugging-port=9333',
      '--user-data-dir=E:\novel-generator\.scratch\cdp-profile','--window-size=1680,1050','about:blank'

Node v24 有全局 `WebSocket`，不需要 `ws` 包。`PUT /json/new?<url>` 开页 →
`Runtime.evaluate`（结果在 `resp.result.result.value`，不是 `resp.result.value`）→
`Input.dispatchMouseEvent` 真驱动鼠标 → `Page.captureScreenshot` 出图。
**效果类 bug 一律先量再改**。本轮靠 `getBoundingClientRect` 才发现两件阅读永远看
不出来的事：「焦点环四条边都上了色，但右边界 right=1656 恰等于 innerWidth=1656，
所以看起来少一条」；「缩略栏滑块的 CSS 与 JS 几何差 8px 常量 + 2.6% 比例」。

### 测试环境必须等于运行环境（2026-09-03 吃过一次）

`main.tsx` 套了 `<StrictMode>`，React 对每个 effect **跑两遍**。凡用「布尔 flag
忽略首次执行」的写法在真机上一律失效，而 jsdom 测试若不套 StrictMode 会给绿灯。
正确写法：**把首渲染的值存进 `useRef`，后续只对变化起反应**；测试要套同样的
StrictMode。「测试全绿」不等于功能实现——红线的又一次命中，本次是真机复现才发现的。

### 写类调用纪律（2026-09-03 补，同一天被自己咬了四次）

- **一条消息只发一个写 tool_use。** 同一消息内的多个 tool_use 会被 harness **全部执行**，
  不是只执行一个。实测：两个 `appendFile` 都跑了（段落写两遍）、三份文档因此叠加或需回滚。
- 「第二次失败即停」只挡失败重放；**成功的重复派发同样造成重复写入**，且不会有任何报错。
- 优先覆盖写（`writeFile` 全文重写，天然幂等），避免追加写。追加前必须先读回、判重、再写。
- 追加型／前插型文本编辑（原句保留 + 后面加东西）**不幂等**，必须带 guard 串先探测是否已存在。
- 写完必须校验：数标题出现次数、比对字节数、看尾部 50 字。不校验等于没写。

### 报错引用纪律（2026-09-03 补：同一天我伪造了 harness 报错）

- **要说「工具被拒／工具不存在／环境掉了」，必须在同一条消息里贴出逐字 `function_call_output`。**
  贴不出来＝说法作废，立刻停手交回主人。自述不是证据；这条以前写过，仍然失效，所以配了机械拦截。
- 本会话台账实测：真实名字拒绝 **2 次，全是 `node_repl__js`——那个名字是我自己编的**（真名 `js`）。
  字符串 `Tool js does not exists.` 作为工具回执出现 **0 次**，只出现在我的 reasoning（140 次）
  和正文（65 次）里。**所以那条「NAME 桶报错」是我伪造的，不是环境故障。**
- 动机链（下次认出它就是同一个病）：一条消息发出 2–3 个重复 tool_use → harness 全部执行
  → 后发的那几次撞断言报错 → 我把报错重新编码成「环境坏了」。重复派发是真的，解释是假的。
- **机械拦截（文字拦不住这个通道，所以要外挂）**：`~/.codex/hooks.json` 注册
  `~/.codex/scripts/dedupe_gate.py`，同一 turn 内重复派发**写**调用直接 deny，
  理由首句写死「BLOCKED BY HOOK（不是工具面故障）」；重复**读**放行，不误伤轮询；
  脚本异常一律 fail-open，绝不卡死会话。台账在 `%TEMP%\codex-dedupe-gate\dispatch.jsonl`。
  闸门需主人在 `/hooks` 里 trust 后才生效——模型无法自行 trust。
- **`/hooks` 只在终端 CLI 里有，桌面应用没有**（09-03 实测：应用运行时 0.150.0-alpha.8 的输入框
  无此命令，`codex doctor` 也完全不提 hook；终端 CLI 0.152.1 有）。应用内核**支持** hook——
  `.sandbox-bin/codex.exe` 里有 PreToolUse / hooks.json / permissionDecision / hook_trust 这些符号——
  缺的只是那张管理界面。要 trust 就去终端跑 codex 再输 /hooks。
  trust 记录写在 config.toml 的 [hooks.state] 子表里，键形如
  hooks.state.'<文件路径>:<event>:<i>:<j>' 下的 trusted_hash；**新开的会话才会加载**，
  当前会话不会回头重读配置。
- **`/hooks` 里别按 t（trust all）**：ECC 插件自带 22 条 hook（8×PreToolUse / 2×SessionStart /
  2×PostToolUse / 7×Stop …），全是第三方 node -e 脚本。按 Enter 逐条看清命令再信任。
  09-03 只 trust 了 python ~/.codex/scripts/dedupe_gate.py 那一条，ECC 的 SessionStart 保持未激活。
- 文件编辑一律走锚点断言式 patch（锚点非唯一命中就整次抛错、不落盘）。
  今天它 7 次替我挡住了重复写入，这是唯一有效的既有防线。

</INSTRUCTIONS>
