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
