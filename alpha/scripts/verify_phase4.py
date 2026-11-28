"""Run the Alpha delivery checks on isolated databases and real local HTTP."""

import importlib.metadata
import json
import os
import platform
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault(
    "STUDYSEAT_EVIDENCE_DIR",
    str(Path(__file__).resolve().parents[1] / "evidence/phase4-integration"),
)
from verify_phase3 import ALPHA, EVIDENCE, NODE, browser_case, run  # noqa: E402


def main():
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / "verification.json").unlink(missing_ok=True)
    run(
        [sys.executable, "-m", "pytest", "-q", f"--junitxml={EVIDENCE / 'pytest.xml'}"],
        "pytest.txt",
        ALPHA,
    )
    run([sys.executable, "-m", "ruff", "check", "."], "ruff-check.txt", ALPHA)
    run([sys.executable, "-m", "ruff", "format", "--check", "."], "ruff-format.txt", ALPHA)
    for file in [ALPHA / "studyseat/static/app.js", *sorted((ALPHA / "tests").glob("*.cjs"))]:
        run([NODE, "--check", str(file)], f"syntax-{file.name}.txt")
    restart_env = dict(os.environ, STUDYSEAT_EVIDENCE_DIR=str(EVIDENCE / "restart"))
    run([sys.executable, "scripts/process_smoke.py"], "process-smoke.txt", ALPHA, restart_env)
    run(
        [sys.executable, "scripts/phase3_process_smoke.py"],
        "phase3-process-smoke.txt",
        ALPHA,
        restart_env,
    )
    with tempfile.TemporaryDirectory(prefix="phase4-ui-") as temporary:
        for script in (
            "browser.cjs",
            "reservations-browser.cjs",
            "account-switch.cjs",
            "initialization-browser.cjs",
            "reservation-list-browser.cjs",
            "phase3-browser.cjs",
            "phase3-review-browser.cjs",
        ):
            browser_case(Path(temporary), script)
    run([sys.executable, "scripts/phase4_load.py"], "performance.txt", ALPHA)
    result = {
        "result": "passed",
        "executed_at": datetime.now(timezone.utc).isoformat(),
        "baseline": "328a3b3d9784d33832094610610498ae14d30935",
        "platform": platform.platform(),
        "python": sys.version,
        "sqlite": sqlite3.sqlite_version,
        "packages": {
            name: importlib.metadata.version(name) for name in ("Flask", "pytest", "ruff")
        },
        "scope": "Alpha backend, syntax, restart, v1-v3 migration and timeout processes, seven browser suites, HTTP load; historical prototype excluded",
    }
    (EVIDENCE / "verification.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
