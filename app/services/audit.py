import json
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from app.core.config import get_settings


settings = get_settings()


def init_db() -> None:
    with closing(sqlite3.connect(settings.audit_db_path)) as con:
        with con:
            con.execute(
                """CREATE TABLE IF NOT EXISTS query_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    question TEXT NOT NULL,
                    source_used TEXT NOT NULL,
                    trace_json TEXT NOT NULL
                )"""
            )
            cutoff = (
                datetime.now(timezone.utc) - timedelta(days=settings.audit_retention_days)
            ).isoformat()
            con.execute("DELETE FROM query_audit WHERE created_at < ?", (cutoff,))



def write_audit(question: str, source_used: str, trace: list[str]) -> None:
    audited_question = question if settings.audit_store_questions else "[redacted]"
    with closing(sqlite3.connect(settings.audit_db_path)) as con:
        with con:
            con.execute(
                "INSERT INTO query_audit(created_at, question, source_used, trace_json) VALUES (?, ?, ?, ?)",
                (
                    datetime.now(timezone.utc).isoformat(),
                    audited_question,
                    source_used,
                    json.dumps(trace),
                ),
            )