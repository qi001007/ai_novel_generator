# UI 待清账（勾完即删该条）

职责边界：本文件**只记未完成的界面条目**。理由在 `DECISIONS.md`，进度史在
`WORKSTREAM-PLAN.md`，视觉规格在 `UI-DESIGN.md`。做完一条就把结论写成
`WORKSTREAM-PLAN`《四、历史》一行，然后**把整条从本文件删掉**，不要在这里堆历史。
处理闭环（先写文件→按严重度一条一条做→真机截图→同批改断言→单独提交）在
`AGENTS.md`《UI 批注处理闭环》。

**开工前必读的三条纪律**（每一条都是踩出来的）：

0. **主人新提的任何东西，先写进本文件，再动手；一条都不留在对话里。**
   2026-09-05 主人原话：「你先把这几轮没弄的需求都给我记到 MD 文件里面去，
   **不要再在这里靠记忆了**。」同一轮里他还说过「我每次跟你提了之后，你老是经常容易忘记」。
   记忆不是存储，对话必被截断。落不进文件的请求等于没提。
1. **效果类改动必须真机截图、自己看过**才算完成。只看 diff 不算。
2. **「我怀疑的那个东西不存在」≠「主人看到的东西是什么」**。前一条让我把同一个问题
   答错三次（行号与正文之间那条线），因为我只证明了边框是 0px，从没去枚举接缝上
   到底站着哪些元素。量法见文末「取证脚本」。

---

## 一、未结的界面条目（按主人点名次数排序）

- [ ] **对比度剩三处（品牌色决定，需主人拍板）**：`--accent` 压自己的淡色底 4.29；
      深色主题白字压 `--accent` 3.31；深色**禁用态主按钮** 4.00
      （`--control-disabled-accent-fg #9a8883` 压 `--control-disabled-accent-bg #3a2b27`，
      第十九批 19.3 复量时抓到，改前就有。蓝色系那一对已换成 5.07，朱砂要不要一起抬，一起拍）。
- [ ] **`UI-DESIGN §0.1` 那张表有三个值和代码不一致**（19.3 顺手发现，未改）：
      表里 dark `surface #1C1C1E`、`surface-alt #26262A`、light `text-2 #73716C`，
      代码是 `#1f2023`、`#191a1b`、`#6d6b66`（后两处正是第十轮批注 1 与 `--text-2` 那一次修定的）。
      这是文档漂移不是界面缺陷，但它是「文档说的和跑着的不是一回事」。
- [ ] **顶栏那枚图标钮是方框**（第二十批 20.5 登记）：`/` 的「设置」与 `/settings` 的
      「返回上一页」是 42×32 带描边的方框，而工作台同一位置是无边框图标钮 -
      与 §0.7 条一不一致。20.1 只修了居中没改外观（主人没提），要统一另开一条。
- [ ] **伏笔墙 / 地图面板接上真实数据源**：面板内**零请求**，是未接线，不是没数据（别再重复排查）。
      **2026-09-05 主人明确排到最后：「伏笔墙跟地图的数据接线往后靠，先把其他的做了」**

---

## 二、被后端语义卡住的（不要在前端臆造第二条写通路）

- [ ] 树右键「重命名 / 删除」：全仓除 `chat.py` **无任何 delete 路由**。
      与 **Q-07**（反馈记录进不进文件层）、**Q-09**（人物删除必然 405）、「删除作品」是**同一条决策**，一起定。
- [ ] 书架上误建的 `dbg`（novel id=6）删不掉，同因。

---

## 三、取证脚本（每轮 UI 改动后跑一遍，别靠目测）

放在 `.scratch/`（已 gitignore，改动不入仓库，结论写进文档）：

- `cdp.mjs` → `connect(url)` 返回 `{ evaluate, click, clickPoint, send, shot, close }`；
  无 Chrome，用裸 Edge + CDP（端口 9333）。
- **写 CDP 脚本一律 `-Encoding utf8`**。用 `ascii` 会把脚本里的中文静默变成 `?`，
  于是 `find(n => n.getAttribute("aria-label") === "展开调用记录")` 永远匹配不上，
  报出来的「控件不存在」全是脚本 bug——本会话被它误导三次。
- **命中区审计**：`node .scratch/hit-area-audit.mjs [url] [open-file|appearance]`。
  它**不信 CSS 盒子**（上一轮就是盒子骗的我：`.tree-prefix` 写着 28px，实际被 overflow
  裁掉），而是用 `elementFromPoint` 从控件中心向四向走，量「真点得到」的范围。
  三段输出：`small`（命中 < 24px）、`clipped`（命中框任何一部分落在最近滚动/裁切容器之外）、
  `unreachable`（中心被别的东西盖住）。改完任何一处控件尺寸都跑一遍。
- **对比度审计**：逐元素算合成背景与前景的 WCAG 比值（浅色主题曾一次抓出 13 处不过 AA）。
- **量「主人看到的线」的正确方法**：给定一条视觉接缝，枚举 `elementFromPoint` 沿途
  以及两侧容器**所有子元素**的 `left/right/backgroundColor`，不要只查你怀疑的那个元素有没有 border。
- **改字号之后**：`#root` 上有 zoom，指针像素 ≠ CSS 像素，任何把指针变成坐标或宽度的地方
  必须过 `toCssPx()`；量法是「拖 80px 看栏宽是不是正好走 80px」「右键菜单的左上角与
  点击点 gap 是否为 0」。

---

## 四、门禁（每次推送前必须全绿）

```
cd E:\novel-generator\backend;  .venv\Scripts\python.exe -m pytest -q      # 200 passed
cd E:\novel-generator\frontend; npm run test -- --run                        # 182 passed / 20 files
cd E:\novel-generator\frontend; npx tsc -b --force --pretty false            # 必须 clean，--force 别信增量
cd E:\novel-generator\frontend; npm run build                                # 必须 clean
cd E:\novel-generator\.scratch; node hit-area-audit.mjs <url>                # 0 small / 0 clipped / 0 unreachable
git -c http.proxy=http://127.0.0.1:7890 push origin main
```

测试要**跟着设计改断言**，不许删。`WorkbenchLayout.test.tsx` 里那条把「按两次方向键」
写成 `300 + 32` 的算式而不是字面量——上次它绑死 312，因为默认值变了而以错误的原因失败。
