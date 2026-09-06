"""Snapshots and the export directory.

Two things that belong together: where an exported file goes, and what the app keeps of a
book it is about to destroy. The delete door is one click now (batch 24 comment 1) and
there is no recycle bin (D-23), so a snapshot taken *before* the delete is the entire
safety net - and because the database is one SQLite file, that net is one copy.
"""

from __future__ import annotations

import re
import sqlite3
from datetime import datetime
from pathlib import Path

from sqlmodel import Session

from app.models import AppConfig

EXPORT_DIR_KEY = "export.dir"
SAFE_NAME = re.compile(r'[\\/:*?"<>|]')


class StorageError(Exception):
    """A reason the author can act on, carried to the router as an HTTP status."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def database_file(session: Session) -> Path | None:
    """The file behind this session, or None when it is not a file.

    Tests run on an in-memory database, so snapshots are simply absent there - which is
    also what a test that only checks "the delete still works" wants.
    """
    url = str(session.get_bind().url)
    if not url.startswith("sqlite:///"):
        return None
    raw = url[len("sqlite:///"):]
    if not raw or ":memory:" in raw:
        return None
    path = Path(raw)
    return path if path.is_absolute() else (Path.cwd() / path).resolve()


def get_export_dir(session: Session) -> str:
    row = session.get(AppConfig, EXPORT_DIR_KEY)
    return (row.value if row else "") or ""


def set_export_dir(session: Session, value: str) -> str:
    cleaned = (value or "").strip().strip('"')
    if cleaned:
        path = Path(cleaned)
        if not path.is_absolute():
            raise StorageError(400, "导出目录要填绝对路径，例如 E:\\novel-exports")
        try:
            path.mkdir(parents=True, exist_ok=True)
        except OSError as cause:
            raise StorageError(400, f"这个目录打不开：{cause}") from cause
    row = session.get(AppConfig, EXPORT_DIR_KEY)
    if row is None:
        row = AppConfig(key=EXPORT_DIR_KEY, value=cleaned)
    else:
        row.value = cleaned
    session.add(row)
    session.commit()
    return cleaned


# ---------- 快照：删除之前先复制一份现场 ----------

SNAPSHOT_RE = re.compile(r"^(deleted|manual)-(\d{8}-\d{6})-(\d+)-(.*)\.db$")
KEEP = 20


def backups_dir(session: Session) -> Path | None:
    src = database_file(session)
    return src.parent / "backups" if src else None


def snapshot(session: Session, novel_id: int, title: str, reason: str = "deleted") -> Path | None:
    """Copy the live database into backups/<reason>-<时间>-<id>-<书名>.db.

    SQLite's backup API rather than a file copy: the server is running and a plain copy can
    catch the file mid-write. Returns None for an in-memory database (tests), which keeps
    "delete still works" testable without a filesystem.
    """
    src = database_file(session)
    if src is None or not src.exists():
        return None
    root = src.parent / "backups"
    root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe = SAFE_NAME.sub("_", title)[:40] or "unnamed"
    target = root / f"{reason}-{stamp}-{novel_id}-{safe}.db"
    with sqlite3.connect(str(src)) as source, sqlite3.connect(str(target)) as dest:
        source.backup(dest)
    prune(root)
    return target


def prune(root: Path, keep: int = KEEP) -> None:
    """Keep the newest N snapshots. Unlimited snapshots are just a disk leak with a nice name."""
    files = sorted([*root.glob("deleted-*.db"), *root.glob("manual-*.db")], reverse=True)
    for old in files[keep:]:
        old.unlink(missing_ok=True)


def list_snapshots(session: Session) -> list[dict]:
    root = backups_dir(session)
    if root is None or not root.exists():
        return []
    found = []
    for path in sorted(root.glob("*.db"), reverse=True):
        match = SNAPSHOT_RE.match(path.name)
        if not match:
            continue
        reason, stamp, novel_id, title = match.groups()
        found.append(
            {
                "file": path.name,
                "reason": "删除前" if reason == "deleted" else "手动",
                "taken_at": f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]} {stamp[9:11]}:{stamp[11:13]}:{stamp[13:15]}",
                "novel_id": int(novel_id),
                "title": title,
                "bytes": path.stat().st_size,
            }
        )
    return found


def _snapshot_path(session: Session, file: str) -> Path:
    """Only a file inside the backups directory, matched by name - no traversal."""
    root = backups_dir(session)
    if root is None:
        raise StorageError(503, "这个数据库没有备份目录（内存库）")
    candidate = (root / Path(file or "").name).resolve()
    if candidate.parent != root.resolve() or not SNAPSHOT_RE.match(candidate.name):
        raise StorageError(400, "只认备份目录里的快照文件名")
    if not candidate.exists():
        raise StorageError(404, "这个快照已经不在了")
    return candidate


def _snapshot_session(path: Path) -> "Session":
    from sqlalchemy.pool import NullPool
    from sqlmodel import Session, create_engine

    # NullPool 是必需的，不是讲究：默认连接池会在 Session 关掉之后**继续留着那条
    # sqlite 连接**，于是快照文件被自己的进程占着删不掉（真机撞到过），
    # 而且每看一次快照就多攒一个池子 - 正是主人担心的那种增长。
    engine = create_engine(
        f"sqlite:///{path.as_posix()}",
        connect_args={"check_same_thread": False},
        poolclass=NullPool,
    )
    return Session(engine)


def snapshot_documents(session: Session, file: str) -> list[dict]:
    """What is inside one snapshot - the books and the documents each one could give back."""
    path = _snapshot_path(session, file)
    from app.services import documents

    out: list[dict] = []
    with _snapshot_session(path) as snap:
        for novel in snap.exec(_select_novels()).all():
            for meta in documents.list_files(snap, novel.id):
                out.append(
                    {"novel_id": novel.id, "novel_title": novel.title, "path": meta.path, "label": meta.label}
                )
    return out


def restore_novel(session: Session, file: str) -> dict:
    """Put one book back, rows and all, from its snapshot. Never overwrites what is there."""
    path = _snapshot_path(session, file)
    match = SNAPSHOT_RE.match(path.name)
    novel_id = int(match.group(3))
    conn = session.connection()
    if conn.exec_driver_sql("SELECT 1 FROM novel WHERE id = ?", (novel_id,)).fetchone():
        raise StorageError(409, f"第 {novel_id} 号书还在书架上，不覆盖")
    conn.exec_driver_sql("ATTACH DATABASE ? AS snap", (str(path),))
    plan: list[tuple[str, str, list[tuple]]] = []
    try:
        # 先把要搬的东西全部读进内存再 detach：DETACH 在有未关闭游标时会报
        # 「database snap is locked」（第一版就是这么炸的），fetchall 是唯一稳的写法。
        tables = [
            row[0]
            for row in conn.exec_driver_sql(
                "SELECT name FROM snap.sqlite_master WHERE type='table' AND name <> 'sqlite_sequence'"
            ).fetchall()
        ]
        live = {
            row[0]
            for row in conn.exec_driver_sql(
                "SELECT name FROM main.sqlite_master WHERE type='table'"
            ).fetchall()
        }
        # 先父后子：novel 那一行得先在，别人才指得到它。
        for table in ["novel"] + [name for name in tables if name != "novel"]:
            if table not in live or table not in tables:
                continue
            shared = [c[1] for c in conn.exec_driver_sql(f"PRAGMA main.table_info({table})").fetchall()]
            snap_cols = [c[1] for c in conn.exec_driver_sql(f"PRAGMA snap.table_info({table})").fetchall()]
            columns = [c for c in shared if c in snap_cols]
            key = "id" if table == "novel" else ("novel_id" if "novel_id" in columns else None)
            if not columns or key is None:
                continue
            names = ", ".join(f'"{c}"' for c in columns)
            rows = conn.exec_driver_sql(
                f'SELECT {names} FROM snap."{table}" WHERE {key} = ?', (novel_id,)
            ).fetchall()
            plan.append((table, names, [tuple(row) for row in rows]))
    finally:
        conn.exec_driver_sql("DETACH DATABASE snap")

    rows_count = 0
    for table, names, payload in plan:
        placeholders = ", ".join(["?"] * len(names.split(", ")))
        for row in payload:
            conn.exec_driver_sql(
                f'INSERT OR IGNORE INTO main."{table}" ({names}) VALUES ({placeholders})', row
            )
            rows_count += 1
    session.commit()
    title_row = (
        session.connection()
        .exec_driver_sql("SELECT title FROM novel WHERE id = ?", (novel_id,))
        .fetchone()
    )
    return {"novel_id": novel_id, "title": title_row[0] if title_row else "", "rows": rows_count}


def restore_document(session: Session, file: str, novel_id: int, path: str, into: str) -> dict:
    """Give one document back.

    into="book" writes it through the single document write path (D-01) - no second door,
    not even for a restore. into="dir" drops it in the export directory instead, which is
    what the owner asked for when the book itself is gone and he only wants that one file.
    """
    from app.services import documents

    snap_path = _snapshot_path(session, file)
    with _snapshot_session(snap_path) as snap:
        try:
            doc = documents.read_file(snap, novel_id, path)
        except documents.DocumentError as cause:
            raise StorageError(cause.status_code, cause.detail) from cause
        title_row = snap.exec(_select_novels()).all()
        novel_title = next((n.title for n in title_row if n.id == novel_id), "")
    if into == "book":
        if not session.exec(_select_novels().where(_novel_id_col() == novel_id)).first():
            raise StorageError(409, "这本书已经不在书架上了")
        try:
            documents.write_file(session, novel_id, path, doc.text, actor="human")
        except documents.DocumentError as cause:
            raise StorageError(cause.status_code, cause.detail) from cause
        return {"restored": "book", "path": path, "novel_id": novel_id}
    if into != "dir":
        raise StorageError(400, "into 只支持 book 或 dir")
    saved = write_export(session, f"{novel_title}_{doc.label}.md", doc.text)
    return {"restored": "dir", "saved_to": str(saved), "path": path}


def _select_novels():
    from sqlmodel import select

    from app.models import Novel

    return select(Novel)


def _novel_id_col():
    from app.models import Novel

    return Novel.id


def write_export(session: Session, file_name: str, text: str) -> Path:
    """Put an exported file into the configured directory.

    This writes to disk only. The database still has exactly one write path (D-01) -
    an export is a read that happens to land somewhere.
    """
    directory = get_export_dir(session)
    if not directory:
        raise StorageError(409, "还没有设置导出目录")
    safe = SAFE_NAME.sub("_", file_name) or "export.txt"
    target = Path(directory) / safe
    target.write_text(text, encoding="utf-8")
    return target
