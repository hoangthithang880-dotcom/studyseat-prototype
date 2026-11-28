"""Run Alpha delivery checks on isolated databases and collect independent failures."""

import importlib.metadata
import json
import os
import platform
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault(
    "STUDYSEAT_EVIDENCE_DIR",
    str(
        Path(__file__).resolve().parents[1]
        / "evidence/prototype-ui-integration"
        / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    ),
)
from verify_phase3 import ALPHA, EVIDENCE, NODE, ROOT, browser_case, prototype_browser, run  # noqa: E402

BROWSER_SUITES = (
    "browser.cjs",
    "reservations-browser.cjs",
    "account-switch.cjs",
    "initialization-browser.cjs",
    "reservation-list-browser.cjs",
    "phase3-browser.cjs",
    "phase3-review-browser.cjs",
    "prototype-integration-browser.cjs",
    "prototype-async-browser.cjs",
)


def main():
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    checks = {}
    failures = {}

    def record(name, operation, *args):
        try:
            operation(*args)
            checks[name] = "passed"
        except (OSError, subprocess.SubprocessError, RuntimeError) as error:
            checks[name] = "failed"
            reason = (
                f"command exited with status {error.returncode}"
                if isinstance(error, subprocess.CalledProcessError)
                else str(error)
            )
            failures[name] = reason
            print(f"{name}: {reason}", flush=True)

    record(
        "pytest",
        run,
        [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "--tb=short",
            f"--junitxml={EVIDENCE / 'pytest.xml'}",
        ],
        "pytest.txt",
        ALPHA,
    )
    record("ruff-check", run, [sys.executable, "-m", "ruff", "check", "."], "ruff-check.txt", ALPHA)
    record(
        "ruff-format",
        run,
        [sys.executable, "-m", "ruff", "format", "--check", "."],
        "ruff-format.txt",
        ALPHA,
    )
    for file in [
        *sorted((ALPHA / "studyseat/static").glob("*.js")),
        *sorted((ALPHA / "tests").glob("*.cjs")),
    ]:
        record(f"syntax-{file.name}", run, [NODE, "--check", str(file)], f"syntax-{file.name}.txt")
    record(
        "prototype-tests",
        run,
        [NODE, "--test", *map(str, sorted((ROOT / "tests").glob("*.test.cjs")))],
        "prototype-tests.txt",
    )
    restart_env = dict(os.environ, STUDYSEAT_EVIDENCE_DIR=str(EVIDENCE / "restart"))
    for script in ("process_smoke", "phase3_process_smoke"):
        record(
            script,
            run,
            [sys.executable, f"scripts/{script}.py"],
            f"{script.replace('_', '-')}.txt",
            ALPHA,
            restart_env,
        )
    with tempfile.TemporaryDirectory(prefix="phase4-ui-") as temporary:
        for script in BROWSER_SUITES:
            record(script, browser_case, Path(temporary), script)
        record("prototype-browser", prototype_browser, Path(temporary))
    audit_dir = EVIDENCE / "prototype-integration-browser"
    if not (audit_dir / "AI-INTERACTION-AUDIT.json").exists():
        record(
            "interaction-inventory",
            run,
            [NODE, str(ALPHA / "tests/prototype-integration-browser.cjs"), "--inventory"],
            "interaction-inventory.txt",
            ROOT,
            dict(
                os.environ,
                STUDYSEAT_EVIDENCE_DIR=str(audit_dir),
                STUDYSEAT_AUDIT_BLOCKER=failures.get(
                    "prototype-integration-browser.cjs", "浏览器自检没有生成执行报告。"
                ),
            ),
        )
    if checks["prototype-integration-browser.cjs"] == "passed":
        if not (audit_dir / "AI-INTERACTION-AUDIT.json").exists() or not all(
            entry["result"] == "passed"
            for entry in json.loads(
                (audit_dir / "AI-INTERACTION-AUDIT.json").read_text(encoding="utf-8")
            )["checks"]
        ):
            checks["prototype-integration-browser.cjs"] = "failed"
            failures["prototype-integration-browser.cjs"] = "Browser interaction results missing"
    record("http-load", run, [sys.executable, "scripts/phase4_load.py"], "performance.txt", ALPHA)
    result = {
        "result": "failed" if failures else "passed",
        "executed_at": datetime.now(timezone.utc).isoformat(),
        "commit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "platform": platform.platform(),
        "python": sys.version,
        "sqlite": sqlite3.sqlite_version,
        "packages": {
            name: importlib.metadata.version(name) for name in ("Flask", "pytest", "ruff")
        },
        "checks": checks,
        "failures": failures,
    }
    (EVIDENCE / "verification.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return bool(failures)


if __name__ == "__main__":
    sys.exit(main())
