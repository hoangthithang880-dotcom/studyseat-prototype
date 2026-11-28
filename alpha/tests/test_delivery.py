"""Verify committed WAL data survives backup and existing files stay intact."""

import sqlite3
import subprocess
import sys
import threading
import time
from contextlib import closing

import pytest

from scripts import verify_phase2, verify_phase3
from scripts.backup_db import backup
from studyseat import create_app
from studyseat.db import get_db, initialize


def test_backup_restores_committed_wal_data(tmp_path):
    source, target = tmp_path / "live.db", tmp_path / "restore.db"
    with sqlite3.connect(source) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE records(id PRIMARY KEY, value)")
        connection.execute("INSERT INTO records VALUES(1, 'committed')")
        connection.commit()
        backup(source, target)
    with sqlite3.connect(target) as restored:
        assert restored.execute("SELECT value FROM records").fetchone()[0] == "committed"
        assert restored.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def test_backup_refuses_overwrite(tmp_path):
    source, target = tmp_path / "live.db", tmp_path / "existing.db"
    source.touch()
    target.write_bytes(b"keep existing backup")
    with pytest.raises(FileExistsError):
        backup(source, target)
    assert target.read_bytes() == b"keep existing backup"


def test_backup_missing_source_creates_no_database(tmp_path):
    source, target = tmp_path / "missing.db", tmp_path / "copy.db"
    with pytest.raises(FileNotFoundError):
        backup(source, target)
    assert not source.exists() and not target.exists()


@pytest.mark.parametrize("verifier", [verify_phase2, verify_phase3])
@pytest.mark.parametrize("inherited_encoding", [None, "cp936"])
def test_verifier_captures_utf8_child_logs(tmp_path, monkeypatch, verifier, inherited_encoding):
    monkeypatch.setattr(verifier, "EVIDENCE", tmp_path)
    if inherited_encoding:
        monkeypatch.setenv("PYTHONIOENCODING", inherited_encoding)
    else:
        monkeypatch.delenv("PYTHONIOENCODING", raising=False)
    monkeypatch.setenv("PYTHONUTF8", "0")
    monkeypatch.setenv("REVIEW_INHERITED", "parent-config")
    database = tmp_path / "private.sqlite3"
    environment = {
        "STUDYSEAT_DATABASE": str(database),
        "STUDYSEAT_BROWSER_CHANNEL": "review-channel",
    }
    child = (
        "import os,sys; "
        "assert os.environ['REVIEW_INHERITED']=='parent-config'; "
        "assert os.environ['STUDYSEAT_DATABASE']==sys.argv[1]; "
        "assert os.environ['STUDYSEAT_BROWSER_CHANNEL']=='review-channel'; "
        "assert os.environ['PYTHONIOENCODING']=='utf-8'; "
        "print('中文验证日志')"
    )
    verifier.run(
        [sys.executable, "-c", child, str(database)],
        "output.txt",
        cwd=tmp_path,
        env=environment,
    )
    assert (tmp_path / "output.txt").read_text(encoding="utf-8").strip() == "中文验证日志"
    assert "PYTHONIOENCODING" not in environment
    assert not database.exists()


@pytest.mark.parametrize("verifier", [verify_phase2, verify_phase3])
def test_verifier_keeps_chinese_failure_log_and_exit_status(tmp_path, monkeypatch, verifier):
    monkeypatch.setattr(verifier, "EVIDENCE", tmp_path)
    monkeypatch.setenv("PYTHONIOENCODING", "cp936")
    monkeypatch.setenv("PYTHONUTF8", "0")
    with pytest.raises(subprocess.CalledProcessError) as failure:
        verifier.run(
            [sys.executable, "-c", "print('失败前中文日志',flush=True); raise SystemExit(23)"],
            "failed.txt",
            cwd=tmp_path,
        )
    assert failure.value.returncode == 23
    assert (tmp_path / "failed.txt").read_text(encoding="utf-8").strip() == "失败前中文日志"


def test_initialize_recovers_wal_transition_after_exclusive_lock(tmp_path):
    source = tmp_path / "locked.db"
    with closing(sqlite3.connect(source, check_same_thread=False)) as locker:
        locker.execute("CREATE TABLE existing(value)")
        locker.execute("BEGIN EXCLUSIVE")
        app = create_app(
            {"TESTING": True, "SECRET_KEY": "test-secret-" * 4, "DATABASE": str(source)}
        )

        def unlock():
            time.sleep(0.08)
            locker.commit()

        thread = threading.Thread(target=unlock)
        with app.app_context():
            connection = get_db()
            connection.execute("PRAGMA busy_timeout = 0")
            thread.start()
            try:
                initialize()
            finally:
                thread.join(timeout=2)
            assert connection.execute("PRAGMA user_version").fetchone()[0] == 3
            assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
