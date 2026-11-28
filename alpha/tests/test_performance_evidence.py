"""Run the actual load entry point with isolated code, data and report paths."""

import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.parametrize("relative", [False, True])
def test_load_report_uses_requested_directory_without_touching_history(tmp_path, relative):
    alpha = Path(__file__).resolve().parents[1]
    sandbox = tmp_path / "isolated"
    script = sandbox / "alpha/scripts/phase4_load.py"
    script.parent.mkdir(parents=True)
    shutil.copyfile(alpha / "scripts/phase4_load.py", script)
    shutil.copytree(
        alpha / "studyseat",
        sandbox / "alpha/studyseat",
        ignore=shutil.ignore_patterns("__pycache__"),
    )
    old_report = sandbox / "alpha/evidence/phase4-integration/performance.json"
    old_report.parent.mkdir(parents=True)
    old_report.write_bytes(b'{"historical_report":"keep original bytes"}\n')
    daily_database = sandbox / "daily.sqlite3"
    daily_database.write_bytes(b"private database sentinel; never open from the load script")
    protected = {
        path: hashlib.sha256(path.read_bytes()).hexdigest() for path in (old_report, daily_database)
    }
    requested = Path("fresh-evidence") if relative else tmp_path / "absolute-evidence"
    environment = dict(
        os.environ,
        STUDYSEAT_EVIDENCE_DIR=str(requested),
        STUDYSEAT_DATABASE=str(daily_database),
        PYTHONIOENCODING="utf-8",
    )
    completed = subprocess.run(
        [sys.executable, str(script)],
        cwd=sandbox,
        env=environment,
        capture_output=True,
        encoding="utf-8",
        check=True,
        timeout=120,
    )
    report_path = (sandbox / requested if relative else requested) / "performance.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert json.loads(completed.stdout)["integrity_check"] == report["integrity_check"] == "ok"
    assert report["database_reservations"] == 1
    assert len(report["reports"]) == 4
    assert report["reports"][-1]["http_status"] == {"201": 1, "409": 19}
    for path, digest in protected.items():
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
