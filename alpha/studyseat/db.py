import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from flask import current_app, g


def is_busy(error):
    if not isinstance(error, sqlite3.OperationalError):
        return False
    code = getattr(error, "sqlite_errorcode", None)
    if code is not None:
        return code & 0xFF in (5, 6)  # SQLITE_BUSY / SQLITE_LOCKED, including extended codes.
    # Python 3.10 has no sqlite_errorcode attribute.
    return (
        str(error)
        .lower()
        .startswith(
            (
                "database is locked",
                "database table is locked",
                "database schema is locked",
                "database is busy",
            )
        )
    )


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"], timeout=5, isolation_level=None)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        g.db.execute("PRAGMA busy_timeout = 5000")
    return g.db


def close_db(error=None):
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


@contextmanager
def write_transaction():
    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def initialize():
    connection = get_db()
    # Concurrent DELETE-to-WAL transitions can return BUSY immediately, even
    # with busy_timeout configured. Retry only contention, within a fixed budget.
    deadline = time.monotonic() + 5
    while True:
        try:
            connection.execute("PRAGMA journal_mode = WAL")
            break
        except sqlite3.OperationalError as error:
            if not is_busy(error) or time.monotonic() >= deadline:
                raise
            time.sleep(0.02)
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    if version not in (0, 1, 2, 3):
        raise RuntimeError("Unsupported database schema version")
    schema = Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")
    try:
        connection.executescript("BEGIN IMMEDIATE;\n" + schema)
        # Another initializer may have upgraded while this process waited for its lock.
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version not in (0, 1, 2, 3):
            raise RuntimeError("Unsupported database schema version")
        connection.execute("INSERT OR IGNORE INTO schema_versions VALUES (1, ?)", (utc_now(),))
        if version < 2:
            migration = Path(__file__).with_name("migrations") / "002_phase3.sql"
            # executescript implicitly commits; execute individual SQL statements
            # so v1 bootstrap and v2 upgrade share the same rollback boundary.
            for statement in migration.read_text(encoding="utf-8").split(";"):
                if statement.strip():
                    connection.execute(statement)
            connection.execute("INSERT INTO schema_versions VALUES (2, ?)", (utc_now(),))
        if version < 3:
            migration = Path(__file__).with_name("migrations") / "003_state_version.sql"
            for statement in migration.read_text(encoding="utf-8").split(";"):
                if statement.strip():
                    connection.execute(statement)
            connection.execute("INSERT INTO schema_versions VALUES (3, ?)", (utc_now(),))
        connection.execute("PRAGMA user_version = 3")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
