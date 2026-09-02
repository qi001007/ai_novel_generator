<!-- 开新对话只需读这一份 + 它指向的文件。本文件不写后端契约、不写帧审批状态、不写死提交哈希。
     职责边界见 DECISIONS.md 第 6 节。最后更新 2026-09-03。 -->

# 交接索引 — AI 网文工作台（novel-generator）

## 工作方式（必须遵守）

- 称呼主人，全程中文。
- 大块完整交付：做完整、验证通过再汇报，不要做一点说一点。
- 按 `docs/WORKSTREAM-PLAN.md` 的 S 系列主干顺序推进，每完成一项打勾。
- 及时 commit + push。git 需 `sandbox_permissions=require_escalated`（`.git` 只读挂载）；
  直连 push 必失败，走代理：`git -c http.proxy=http://127.0.0.1:7890 push origin main`
- **UI 铁律**：先在 Figma 画帧 → 截图给主人审批 → 批准后才写前端代码。主动发截图。
- 调 `use_figma` 前先读 `skill://figma/figma-use/SKILL.md`，skillNames 传 `resource:figma-use`。
  本项目 Figma 报错几乎都是脚本层（SCRIPT 桶），见 AGENTS.md 四桶与 DECISIONS 第 4 节 T-01～T-04。
- 遇到主人批评，先复述你理解的问题点再动手。
- 编码四原则：编码前思考 / 简洁优先 / 精准修改 / 目标驱动执行。

## 三条红线（违反即错，不解释）

1. **四层规划只有一条写入口**：`PUT /api/novels/{id}/files/{path}`。禁止新增 `/planning/*` 写端点，
   禁止在任何地方开第二条写通路（DECISIONS D-01）。DB 仍是唯一真源，`.md` 是投影（D-02）。
2. **不许把「测试全绿」说成「功能已实现」**。对话 Agent 目前只有外壳，工具调用 / 联网搜索 /
   多步循环 = 0（ARCHITECTURE §4 缺口 1）。
3. **上下文注入只有一个构造器**，改注入内容只改对应 collector，不改调用方、不改提示词模板、
   不改前端（D-04 / D-06）。

## 环境

- 代码 `E:\novel-generator`；远端 `github.com/qi001007/ai_novel_generator`（main，最新见 `git log -1`）。
- LLM：OpenAI 兼容 `/chat/completions`，BaseURL 与密钥在 `backend/.env`（已 gitignore，勿写进代码或提交）。
  任务类型四个：`draft` / `review` / `summary` / `chat`。当前 `NOVEL_LLM_CHAT_MODEL=MiniMax-M2.5`
  （推理模型，reasoning 计入 `token_output`，是真实账单口径 → T-10）。
- `.scratch/` 存本机过程产物（日志、截图、启动脚本），**不在 git 里**，别在文档中引用它当证据。

## 验证命令（改动后必须全绿）

```powershell
cd E:\novel-generator\backend;  .venv\Scripts\python.exe -m pytest -q    # 期望 101 passed
cd E:\novel-generator\frontend; npm run test -- --run                      # 期望 51 passed
cd E:\novel-generator\frontend; npm run build                              # 期望干净
```

要看注入上下文清单：后端起时带 `$env:NOVEL_CONTEXT_DEBUG = '1'`，跑在**可见终端**里
（主人明确要过：别把方便留给自己、让他去翻日志文件）。

## 读哪份文件

| 你要干什么 | 读哪里 |
|---|---|
| 知道系统实际长什么样、还缺什么 | `docs/ARCHITECTURE.md` |
| 知道某设计为什么这么定 / 哪个旧口径已废 | `docs/DECISIONS.md`（按 D-xx / X-xx / R-xx / T-xx 编号） |
| 改需求、加功能 | `docs/PRD.md` → 同步 `docs/REQUIREMENTS.md` |
| 改界面 | `docs/UI-DESIGN.md`（当前权威版本见其首行） |
| 看进度与待办勾选 | `docs/WORKSTREAM-PLAN.md` |
| 工具报错怎么定责 | `AGENTS.md` 四桶（NAME / ARGS / SCRIPT / QUOTA） |

## 当前主干进度（细节与验收在 WORKSTREAM-PLAN）

```text
S0 上下文可观测   代码已就绪，待跑给主人看一次
S1 最小写作环     待办
S3 写通路收口     待办（含路径迁移，★ 必须在 S2 之前）
S2 agentic 内核   未开始
S4 合流           未开始
```

待主人拍板的存量事项：`DECISIONS.md` 第 5 节 Q-01 ～ Q-06。没答之前不要替他决定。
