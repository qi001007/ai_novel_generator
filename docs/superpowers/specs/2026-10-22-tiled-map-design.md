# M-01 轻量分块扩图设计

日期：2026-10-22
状态：已由主人批准（对话中确认“单块按需扩展、不羽化、要真无缝”）

## 1. 目标与非目标

目标：在现有 M-02 地图库上增加“单块按需扩展”和“单格重绘”，做到新区域与旧图像素级硬拼接，旧区域零改动，不引入羽化、模糊或第二套合成器。

非目标：本地 Stable Diffusion、无限画布库、每格独立文件、图块 manifest、多图块并发合成、站点/登录/云存储。

## 2. 参考

- `lkwq007/stablediffusion-infinity`：无限画布 outpainting 交互，项目 `DECISIONS.md` 已有引用。
- `nano-banana-infinimap`：邻块条件与网格。
- `IMGen-Table`：重叠图块与 manifest（仅参考，不采用其重实现）。

## 3. 核心机制

1. 以父版本整幅图为基础，按方向新建更大的画布，旧图像素放在确定偏移。
2. 新区域涂白生成遮罩，其余黑；白=重绘，黑=保持。
3. 调用 `wanx2.1-imageedit` 的 `description_edit_with_mask`，输出尺寸必须等于输入。
4. 返回后把遮罩外的原始像素逐像素贴回；尺寸不符直接 502，不缩放、不补边。
5. 每次扩图/重绘产生一条整幅草稿版本；确认后才成为正式版本，沿用 M-02 的 confirm/supersede。

## 4. 网格与版本

- 单元格 $1024\times1024$；上限 $4\times4$（供应商单边上限 4096 px，第 16 块顶格）。
- 底图必须 1024 对齐的方图；旧的非方图只读，扩图动作禁用并说明原因。
- 坐标 $x$ 为从西往东的列，$y$ 为从北往南的行，均从 0 开始。
- 每次操作记录 `parent_revision`、`operation`、`edge`、`cell`、`cols`、`rows`、`width`、`height`、`cell_size`。
- 元数据写入 `MapTile.metadata_json`，不新增表、不做数据库迁移。

## 5. API

- `POST /api/maps/{id}/expand`
  - 入参：`parent_revision`、`edge`（east/west/north/south）、`prompt`、`confirm_billing`
  - 出参：`MapDetailOut`
- `POST /api/maps/{id}/cells/{x}/{y}/regenerate`
  - 入参：`parent_revision`、`prompt`、`confirm_billing`
  - 出参：`MapDetailOut`
- 两者均要求 `confirm_billing === true`；付费请求只发一次，不自动重试；轮询与图片下载可重试。
- 供应商未配置或模型不支持遮罩时返回 409，并给出可执行的配置提示。

## 6. 供应商

- 新增任务槽 `image_edit`，默认模型 `wanx2.1-imageedit`；供应商回落到 `image` 路由的供应商。
- DashScope 原生接口：`POST {origin}/api/v1/services/aigc/image2image/image-synthesis`，头 `X-DashScope-Async: enable`；轮询 `GET {origin}/api/v1/tasks/{task_id}`。
- 输入 `base_image_url` / `mask_image_url` 使用 base64 data URL；发请求前检查 payload ≤10 MB。
- 免费验证：AI Horde 匿名 key `0000000000`，`source_processing="inpainting"` + `source_image`/`source_mask`；只做脚本烟测，不进入产品依赖。

## 7. 前端

- 详情页画布支持适配缩放、滚轮缩放、拖拽平移。
- 叠加网格线；四边“+”按钮扩一块；顶格禁用。
- 点击格子选中，侧栏显示坐标与“重绘此格”。
- 扩图/重绘前弹费用确认：本次 1 次付费请求，预计 ¥0.14（以供应商账单为准）。
- 版本历史显示操作类型（初始/向东扩展/重绘第 x 列第 y 行）。

## 8. 测试与验收

- 假供应商走真实 HTTP（本地假 DashScope：submit → poll → 下载），断言遮罩外逐像素等于父图、尺寸精确、每次操作只发 1 次付费请求。
- 断言未确认草稿不改变 active_revision；确认后旧确认版本变 superseded。
- 断言 4×4 上限、非法方向、越界格子、未勾选费用、尺寸不符不落库。
- 前端组件测试覆盖费用弹窗、顶格禁用、选格重绘、草稿默认选中。
- 真机：隔离端口 + 本地假供应商，完整浏览器流程与截图，不碰 8000/5173 和真实数据库。
- 真实生图：V-08 未解除前不做付费调用；AI Horde 免费烟测只验证真实模型能否延续旧图。

## 9. 已知边界

- 接缝处的内容连续性由模型负责；本方案只保证几何与旧像素绝对不变，不靠羽化掩盖。
- 免费接口速度与可用性不受控，仅用于验证。
- 4×4 顶格若被供应商拒绝，按实测收到 3×3 并记录证据。
