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
