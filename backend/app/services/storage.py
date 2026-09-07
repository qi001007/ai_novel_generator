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

    def __init__(self, status_code: int, detail: str, code: str | None = None) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code


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

# 快照文件名的前缀就是「它是为什么拍的」。以前删书、删章、插章腾位三处共用一个默认
# reason="deleted"，快照自己就没记下范围，设置页只能猜 - 它猜成「恢复整本书」，而
# 主人 2026-09-07 批注 1 指的就是这一条：他根本没删整本书。
SNAPSHOT_KINDS = ("book", "chapter", "room", "renumber", "deleted", "manual")
SNAPSHOT_RE = re.compile(
    r"^(book|chapter|room|renumber|deleted|manual)-(\d{8}-\d{6})-(\d+)-(.*)\.db$"
)
SCOPE_LABEL = {
    "book": "删书前",
    "chapter": "删章前",
    "room": "插章前",
    "renumber": "重编号前",
    "deleted": "删除前",  # 旧文件分不出删的是书还是章，只能给一个不带范围的词
    "manual": "手动",
}
KEEP = 20


def backups_dir(session: Session) -> Path | None:
    src = database_file(session)
    return src.parent / "backups" if src else None


def snapshot(session: Session, novel_id: int, title: str, reason: str) -> Path | None:
    """Copy the live database into backups/<reason>-<时间>-<id>-<书名>.db.

    reason 故意不给默认值：三处删除共用过 reason="deleted"，快照就不记得自己是为什么
    拍的，界面只能猜（主人 2026-09-07 批注 1）。新增调用点必须挑一个 SNAPSHOT_KINDS。

    SQLite's backup API rather than a file copy: the server is running and a plain copy can
    catch the file mid-write. Returns None for an in-memory database (tests), which keeps
    "delete still works" testable without a filesystem.
    """
    if reason not in SNAPSHOT_KINDS:
        raise StorageError(500, f"未知的快照类型 {reason!r}，只认 {SNAPSHOT_KINDS}")
    src = database_file(session)
    if src is None or not src.exists():
        return None
    root = src.parent / "backups"
    root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe = SAFE_NAME.sub("_", title)[:40] or "unnamed"
    target = root / f"{reason}-{stamp}-{novel_id}-{safe}.db"
    # `with sqlite3.connect(...)` 只 commit，**不 close** - 上一版就是这么把快照句柄
    # 留在自己进程里，删不掉的不是文件而是我们的礼貌（26.7）。显式关掉两条连接。
    source = sqlite3.connect(str(src))
    dest = sqlite3.connect(str(target))
    try:
        source.backup(dest)
    finally:
        dest.close()
        source.close()
    prune(root)
    return target


def prune(root: Path, keep: int = KEEP) -> None:
    """Keep the newest N snapshots. Unlimited snapshots are just a disk leak with a nice name."""
    # glob 必须跟着前缀走：漏一种，那一种就永不清理，攒成磁盘泄漏（KEEP 就是它的名额）
    files = sorted(
        [found for kind in SNAPSHOT_KINDS for found in root.glob(f"{kind}-*.db")],
        reverse=True,
    )
    for old in files[keep:]:
        old.unlink(missing_ok=True)


def list_snapshots(session: Session) -> list[dict]:
    """一行能做什么，取决于那本书**现在还在不在书架上**，不取决于文件名前缀。

    旧快照全是 deleted-，靠前缀判就还是批注 1 那个错（他没删整本书，界面却让他恢复
    整本书）。所以这里查一次活库的 novel 表，把结论随列表一起给出去。
    """
    root = backups_dir(session)
    if root is None or not root.exists():
        return []
    from sqlmodel import select

    from app.models import Novel

    on_shelf = {int(nid) for nid in session.exec(select(Novel.id)).all()}
    matches = []
    for path in root.glob("*.db"):
        match = SNAPSHOT_RE.match(path.name)
        if match:
            matches.append((path, match))
    # 排序键必须是**时间戳那一段**，不是整个文件名。前缀记下范围以后（批注 1），
    # 按文件名排就成了按字母排：chapter- 永远排在 deleted- 后面，新快照被挤到列表
    # 末尾，「最新在前」当场失效 - 这条是真机上量出来的，不是推出来的。
    found = []
    for path, match in sorted(matches, key=lambda pair: (pair[1].group(2), pair[0].name), reverse=True):
        reason, stamp, novel_id, title = match.groups()
        found.append(
            {
                "file": path.name,
                "scope": reason,
                "scope_label": SCOPE_LABEL.get(reason, reason),
                "book_on_shelf": int(novel_id) in on_shelf,
                "reason": SCOPE_LABEL.get(reason, reason),
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

    第二十八批批注 7：删过一章以后号会前移（28.6），所以快照里那个 `chapters/0002/...`
    今天可能住着**另一章** - 直接写回去就是把别人的正文盖掉。恢复前先认一次身份：
    快照里占这个号的 chapter id 和现在占这个号的 id 不是同一个，就把 >= 这个号的整体
    后移一格，让它弹回原位（他原话：「后面的这些序号也会自动弹回去」）。
    号空着（删的是最后一章）就直接落，不挪任何东西。
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
        from sqlmodel import select

        from app.models import Chapter

        kind, number = documents.resolve_path(path)
        # 参照物是快照自己：记下「快照里每一章住在第几号」。恢复时拿现在占着这个号的
        # 那一章去对照 - 它在快照里住别的号，才说明它是被 28.6 的前移顶上来的。
        snap_positions: dict[int, int] = (
            {int(cid): int(cnum) for cid, cnum in snap.exec(
                select(Chapter.id, Chapter.chapter_number).where(Chapter.novel_id == novel_id)
            ).all()}
            if number is not None
            else {}
        )
        # 恢复正文时若那个号上没有章，要先放回同一快照里的简报（正文不能凭空建章）。
        # 这一句必须留在 with 块里读：出了块 Session 已经 close，再读会另开一条没人关
        # 的连接 - 26.7 那个「快照文件被自己占着删不掉」就是同一个形状。
        sibling_text: str | None = None
        if number is not None and kind == "draft":
            try:
                sibling_text = documents.read_file(
                    snap, novel_id, documents.brief_path(number)
                ).text
            except documents.DocumentError:
                sibling_text = None
    if into == "book":
        if not session.exec(_select_novels().where(_novel_id_col() == novel_id)).first():
            raise StorageError(409, "这本书已经不在书架上了")
        made_room = 0
        if number is not None:
            from app.services.renumber import shift_after

            # 判据是「有没有章被那次删除挤下来过」：某章在快照里住 p 号、现在住 q 号，
            # p > 要恢复的号 且 q < p，就是它当初前移顶上了这个位置 - 恢复时得整体后移
            # 让它弹回去（主人原话「后面的这些序号也会自动弹回去」）。
            # 只看「现在占这个号的是不是别人」是不够的：删掉中间一章后那个号常常是空的
            # （空洞在别处），真机第一次跑就是这样，结果只放回了被恢复那一章、
            # 被挤下来的 9->8、10->9 没弹回去。也不能拿 id 比 - 恢复会新建一行。
            live_rows = session.exec(
                select(Chapter.id, Chapter.chapter_number).where(
                    Chapter.novel_id == novel_id
                )
            ).all()
            needs_room = any(
                snap_positions.get(int(cid)) is not None
                and int(snap_positions[int(cid)]) > number
                and int(q) < int(snap_positions[int(cid)])
                for cid, q in live_rows
            )
            if needs_room:
                made_room = shift_after(session, novel_id, above=number - 1, delta=1)
                session.commit()
        # 正文不能凭空建章（D-13 的底线：简报才是建章那一步，AI 也不能靠写 draft.md
        # 塞一章进来）。所以恢复一份 draft.md 时，若让位之后那个号上没有章，先把同一份
        # 快照里的 brief.md 放回去 - 它才是把章建回来的那一步，走的还是同一条写通路。
        if number is not None and kind == "draft" and session.exec(
            select(Chapter.id).where(
                Chapter.novel_id == novel_id, Chapter.chapter_number == number
            )
        ).first() is None:
            sibling = documents.brief_path(number)
            if sibling_text is None:
                raise StorageError(
                    409, f"这一章的简报不在快照里，先把 {sibling} 放回书里再放正文"
                )
            documents.write_file(session, novel_id, sibling, sibling_text, actor="human")
        try:
            documents.write_file(session, novel_id, path, doc.text, actor="human")
        except documents.DocumentError as cause:
            raise StorageError(cause.status_code, cause.detail) from cause
        return {
            "restored": "book",
            "path": path,
            "novel_id": novel_id,
            "made_room": made_room,
        }
    if into != "dir":
        raise StorageError(400, "into 只支持 book 或 dir")
    saved = write_export(session, f"{novel_title}_{doc.label}.md", doc.text)
    return {"restored": "dir", "saved_to": str(saved), "path": path}


def snapshot_chapters(session: Session, file: str, novel_id: int) -> list[dict]:
    """这一份快照里**有、当前库里已经没有**的那些章。

    批注 1：「我根本没有删除那些章」——展开清单不能把整本书的章都摊出来，只列真少掉
    的那些。身份按 `chapter.id` 认，不按章号：删完一章后面的号会自动前移（28.6），
    拿章号比会把没被删的章也算成少的。

    但只按 id 比还不够 - 恢复会**新建一行**（id 变了），第二次列清单就会把已经回来的
    那一章永远当成少的（D-29 记过这个坑，本条测试真撞上了）。所以再配一次：活库里
    那些「id 不在快照中」的行就是恢复回来的，它们占的号不再算少掉。
    """
    path = _snapshot_path(session, file)
    from sqlmodel import select

    from app.models import Chapter, TocEntry
    from app.services import documents

    live_rows = {
        int(cid): int(num)
        for cid, num in session.exec(
            select(Chapter.id, Chapter.chapter_number).where(
                Chapter.novel_id == novel_id
            )
        ).all()
    }
    out: list[dict] = []
    with _snapshot_session(path) as snap:
        titles = {
            row.chapter_number: row.title
            for row in snap.exec(
                select(TocEntry).where(
                    TocEntry.novel_id == novel_id, TocEntry.is_active == True  # noqa: E712
                )
            ).all()
        }
        rows = snap.exec(
            select(Chapter)
            .where(Chapter.novel_id == novel_id)
            .order_by(Chapter.chapter_number)
        ).all()
        snap_ids = {int(chapter.id) for chapter in rows}
        restored_numbers = {
            num for cid, num in live_rows.items() if cid not in snap_ids
        }
        for chapter in rows:
            number = int(chapter.chapter_number)
            if int(chapter.id) in live_rows or number in restored_numbers:
                continue
            title = titles.get(number, "")
            # 顺序就是恢复顺序：简报先落（它是建章那一步），正文后落。
            paths: list[str] = []
            if chapter.brief_id is not None:
                paths.append(documents.brief_path(number))
            if (chapter.content or "").strip():
                paths.append(documents.draft_path(number))
            out.append(
                {
                    "novel_id": novel_id,
                    "chapter_id": int(chapter.id),
                    "number": number,
                    "title": title,
                    "label": f"第 {number} 章" + (f"《{title}》" if title else ""),
                    "paths": paths,
                }
            )
    return out


def _merge_toc_row(session: Session, snap: Session, novel_id: int, number: int) -> bool:
    """把快照里那一章的目录行**并**回当前目录，别的行一个字不动（28.7b）。

    目录是整本书一份文档，删章时那一行被 vacate 掉了 - 只补文件不补目录，
    树上就从「0002 · 缺名的那个人」退化成光秃秃的「0002」。但不能整份放回：
    那会盖掉别的章名。所以读两边的行，只把缺的那一条插进有序列表再写回，
    走的还是 documents.write_file 那唯一一条口（D-01）。
    """
    from app.services import documents

    try:
        live_rows = documents.load_document(
            "toc", documents.read_file(session, novel_id, "toc.md").text
        )
        if any(int(row["chapter"]) == number for row in live_rows):
            return False
        snap_rows = documents.load_document(
            "toc", documents.read_file(snap, novel_id, "toc.md").text
        )
        wanted = next(
            (row for row in snap_rows if int(row["chapter"]) == number), None
        )
        if wanted is None:
            return False
        merged = sorted(
            [*live_rows, wanted], key=lambda row: int(row["chapter"])
        )
        documents.write_file(
            session,
            novel_id,
            "toc.md",
            documents.render_document("toc", merged),
            actor="human",
        )
    except documents.DocumentError as cause:
        raise StorageError(cause.status_code, cause.detail) from cause
    return True


def restore_chapter(
    session: Session, file: str, novel_id: int, chapter_id: int, into: str
) -> dict:
    """恢复**一章**：简报与正文一起回，不再拆成两次操作（批注 1 后半）。

    「让位」判据不在这里重复实现 - 那是 28.7 定的，唯一出处是 restore_document，
    这里按顺序调它两次（先简报后正文），两步仍走同一条写通路（D-01）。
    第三步补目录那一行（28.7b）：章名唯一的出处就是它，不补就是恢复了个半章。
    """
    wanted = next(
        (
            item
            for item in snapshot_chapters(session, file, novel_id)
            if item["chapter_id"] == chapter_id
        ),
        None,
    )
    if wanted is None:
        raise StorageError(404, "这一章在这份快照里没有少掉，不用恢复")
    paths: list[str] = list(wanted["paths"])
    if not paths:
        raise StorageError(409, "这一章在快照里既没有简报也没有正文")
    if into == "book":
        made_room = 0
        for one in paths:
            result = restore_document(session, file, novel_id, one, "book")
            made_room += int(result.get("made_room", 0))
        number = int(wanted["number"])
        toc_row_back = False
        with _snapshot_session(_snapshot_path(session, file)) as snap:
            toc_row_back = _merge_toc_row(session, snap, novel_id, number)
        return {
            "restored": "book",
            "novel_id": novel_id,
            "chapter_number": number,
            "chapter_title": wanted["title"],
            "paths": paths,
            "made_room": made_room,
            "toc_row": toc_row_back,
        }
    if into != "dir":
        raise StorageError(400, "into 只支持 book 或 dir")
    saved: list[str] = []
    for one in paths:
        result = restore_document(session, file, novel_id, one, "dir")
        saved.append(str(result.get("saved_to", "")))
    return {
        "restored": "dir",
        # 一章两份文件，回执给一条字符串就够，别让前端去猜数组
        "saved_to": " · ".join(saved),
        "paths": paths,
        "chapter_number": wanted["number"],
    }


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
        raise StorageError(409, "还没有设置导出目录", code="export_dir_not_set")
    safe = SAFE_NAME.sub("_", file_name) or "export.txt"
    target = Path(directory) / safe
    target.write_text(text, encoding="utf-8")
    return target
