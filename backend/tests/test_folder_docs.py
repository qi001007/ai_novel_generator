"""每层目录都要有一份够短的 description.md —— 让「了解一个文件夹」不必注入代码。

主人的工作方式（AGENTS.md《项目管理原则》）：靠 description.md 层层深入定位要改哪儿。
文字规则拦不住遗忘，所以这条钉成测试：漏一份、写太长、根目录乱写，都直接红。
"""
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SRC_SUFFIXES = {".py", ".ts", ".tsx", ".css"}
SKIP_DIRS = {".venv", "node_modules", "__pycache__", ".pytest_cache", "backups",
             "dist", "coverage", ".scratch", ".git", ".codex", ".agents", "novel-export"}
MIN_OWN_FILES = 2          # 只有两个以上自产源码文件的目录才要求说明
MAX_LINES = 20
MAX_BYTES = 2400


def _own_files(d: Path) -> list[Path]:
    return [p for p in d.iterdir() if p.is_file() and p.suffix in SRC_SUFFIXES]


def _candidate_dirs() -> list[Path]:
    out = []
    for root in (REPO / "backend", REPO / "frontend"):
        for d in root.rglob("*"):
            if not d.is_dir() or SKIP_DIRS.intersection(d.parts):
                continue
            if len(_own_files(d)) >= MIN_OWN_FILES:
                out.append(d)
    return out


def test_every_source_folder_has_a_description():
    missing = [str(d.relative_to(REPO)) for d in _candidate_dirs()
               if not (d / "description.md").is_file()]
    assert not missing, f"这些目录缺 description.md：{missing}"


def test_descriptions_stay_short():
    too_long = []
    for d in _candidate_dirs() + [REPO / "docs"]:
        doc = d / "description.md"
        if not doc.is_file():
            continue
        lines = doc.read_text(encoding="utf-8").splitlines()
        if len(lines) > MAX_LINES or doc.stat().st_size > MAX_BYTES:
            too_long.append(f"{d.relative_to(REPO)}: {len(lines)} 行 / {doc.stat().st_size} B")
    assert not too_long, (
        f"description.md 超了 {MAX_LINES} 行 / {MAX_BYTES} B 的上限（太长就该拆到子目录或写回代码注释）：{too_long}")


def test_every_description_has_a_backlog_beside_it():
    orphan = [str((d / "backlog.md").parent.relative_to(REPO))
              for d in _candidate_dirs() + [REPO / "docs"]
              if (d / "description.md").is_file() and not (d / "backlog.md").is_file()]
    assert not orphan, f"这些目录有 description.md 却没有 backlog.md：{orphan}"


def test_repo_root_stays_clean():
    for name in ("description.md", "backlog.md"):
        assert not (REPO / name).exists(), f"项目最外层不写 {name}（项目级文档归 docs/）"

DOCS = REPO / "docs"


def test_decisions_index_matches_body():
    """DECISIONS 的 §0 索引必须和正文一一对应。

    正文按时间往下堆、索引按编号查，两边最容易各漂各的（D-24/25 就插到了 D-31 后面）。
    """
    doc = (DOCS / "DECISIONS.md").read_text(encoding="utf-8")
    head, _, rest = doc.partition("## 0. 索引")
    assert rest, "DECISIONS.md 缺 §0 索引"
    index_part, _, body = rest.partition("## 1. ")
    indexed = {m for line in index_part.splitlines()
               for m in [line.strip("| ").split("|")[0].strip()] if m.startswith("D-")}
    written = {ln.split()[1] for ln in doc.splitlines() if ln.startswith("### D-")}
    assert indexed == written, (
        f"索引与正文不符：只在索引 {sorted(indexed - written)} / 只在正文 {sorted(written - indexed)}")


def test_governance_roles_stay_wired():
    """四角色接线必须还在：宪章指路、地图持有分工表、状态指向删除区。"""
    agents = (REPO / "AGENTS.md").read_text(encoding="utf-8")
    assert "文档治理" in agents and "§0.6" in agents, "AGENTS.md 不再指向文档职责表"
    assert "地图定位" in agents, "AGENTS.md 丢了进任务的读序（地图→状态→相关 D-xx）"
    arch = (DOCS / "ARCHITECTURE.md").read_text(encoding="utf-8")
    assert "Map 跳转表" in arch, "ARCHITECTURE.md 丢了 §0.5 代码地图"
    assert "### 0.6 文档职责" in arch, "ARCHITECTURE.md 丢了 §0.6 文档职责表（它才是这张表的主人）"
    status = (DOCS / "WORKSTREAM-PLAN.md").read_text(encoding="utf-8")
    assert "删除区" in status, "WORKSTREAM-PLAN.md 不再指向删除区（DECISIONS §2/§3）"


def test_doc_roles_have_exactly_one_owner():
    """「哪份文档装什么」这张表只许存在一份 —— 抄三处必有一处错（本项目犯过）。"""
    dec = (DOCS / "DECISIONS.md").read_text(encoding="utf-8")
    assert "只装什么" not in dec.split("## 6. 文档职责")[1], (
        "DECISIONS §6 又抄了一份职责表；主人是 ARCHITECTURE §0.6，这里只许留链接")
    agents = (REPO / "AGENTS.md").read_text(encoding="utf-8")
    assert "唯一主人 |" not in agents and "| 宪章 Constitution |" not in agents, (
        "AGENTS.md 里又长出一份角色表；去 ARCHITECTURE §0.6 改那一份")
