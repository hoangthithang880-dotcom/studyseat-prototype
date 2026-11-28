"""Reproduce Phase 3 against temporary databases and real local service processes.

From alpha/: python scripts/verify_phase3.py
Requires Node + Playwright on NODE_PATH; choose an installed browser via
STUDYSEAT_BROWSER_CHANNEL (defaults to msedge, e.g. chrome on macOS).
"""

import hashlib
import importlib.metadata
import json
import os
import platform
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ALPHA = ROOT / "alpha"
EVIDENCE = Path(os.environ.get("STUDYSEAT_EVIDENCE_DIR", ALPHA / "evidence/phase3")).resolve()
NODE = os.environ.get("STUDYSEAT_NODE", "node")


def run(command, log, cwd=ROOT, env=None):
    child_env = dict(os.environ)
    if env is not None:
        child_env.update(env)
    child_env.update(PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    result = subprocess.run(
        command,
        cwd=cwd,
        env=child_env,
        text=True,
        encoding="utf-8",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    (EVIDENCE / log).write_text(result.stdout, encoding="utf-8")
    print(f"{log}: exit {result.returncode}", flush=True)
    if result.returncode:
        print(result.stdout, flush=True)
        raise subprocess.CalledProcessError(result.returncode, command)


def port_number():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_ready(process, url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(100):
        try:
            with opener.open(url, timeout=1):
                return
        except OSError:
            if process.poll() is not None:
                raise RuntimeError("Test server exited; inspect server log")
            time.sleep(0.1)
    raise RuntimeError("Test server startup timed out")


def browser_case(directory, script):
    name = script.removesuffix(".cjs")
    env = dict(
        os.environ,
        STUDYSEAT_DATABASE=str(directory / f"{name}.sqlite3"),
        STUDYSEAT_SECRET_KEY="phase3-isolated-local-test-secret-" * 2,
        STUDYSEAT_HTTPS="0",
        STUDYSEAT_EVIDENCE_DIR=str(EVIDENCE / name),
    )
    run(
        [sys.executable, "-m", "flask", "--app", "studyseat", "init-db", "--demo"],
        f"{name}-init.txt",
        ALPHA,
        env,
    )
    port = port_number()
    env["STUDYSEAT_TEST_URL"] = f"http://127.0.0.1:{port}"
    with (EVIDENCE / f"{name}-server.txt").open("w") as log:
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "flask",
                "--app",
                "studyseat",
                "run",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ],
            cwd=ALPHA,
            env=env,
            stdout=log,
            stderr=log,
        )
        try:
            wait_ready(process, env["STUDYSEAT_TEST_URL"] + "/api/v1/health")
            run([NODE, str(ALPHA / "tests" / script)], f"{name}.txt", env=env)
        finally:
            process.terminate()
            process.wait(timeout=10)


def prototype_browser(directory):
    # Run the historical script in an export; it writes its own historical evidence.
    # Keep source screenshots/release files intact and collect new evidence separately.
    exported = directory / "prototype-export"
    run(
        [sys.executable, str(ROOT / "scripts/prepare-github.py"), "--output", str(exported)],
        "prototype-export.txt",
    )
    port = port_number()
    env = dict(os.environ, STUDYSEAT_BASE_URL=f"http://127.0.0.1:{port}/deploy/")
    with (EVIDENCE / "prototype-server.txt").open("w") as log:
        process = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
            cwd=exported,
            stdout=log,
            stderr=log,
        )
        try:
            wait_ready(process, env["STUDYSEAT_BASE_URL"])
            run([NODE, str(exported / "tests/browser.cjs")], "prototype-browser.txt", exported, env)
            target = EVIDENCE / "prototype-browser"
            target.mkdir(exist_ok=True)
            shutil.copyfile(
                exported / "docs/prototype-browser-results.json", target / "results.json"
            )
            for image in (exported / "docs/screenshots").glob("local-*.png"):
                shutil.copyfile(image, target / image.name)
        finally:
            process.terminate()
            process.wait(timeout=10)


def main():
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / "verification.json").write_text(
        json.dumps({"result": "running", "executed_at": datetime.now(timezone.utc).isoformat()})
        + "\n",
        encoding="utf-8",
    )
    run(
        [sys.executable, "-m", "pytest", "-q", "-rP", f"--junitxml={EVIDENCE / 'pytest.xml'}"],
        "pytest.txt",
        ALPHA,
    )
    run([sys.executable, "-m", "ruff", "check", "."], "ruff-check.txt", ALPHA)
    run([sys.executable, "-m", "ruff", "format", "--check", "."], "ruff-format.txt", ALPHA)
    for name in ("app.js",):
        run([NODE, "--check", str(ALPHA / "studyseat/static" / name)], "js-syntax.txt")
    run(
        [NODE, "--test", *map(str, sorted((ROOT / "tests").glob("*.test.cjs")))],
        "prototype-tests.txt",
    )
    env = dict(os.environ, STUDYSEAT_EVIDENCE_DIR=str(EVIDENCE / "restart"))
    run([sys.executable, str(ALPHA / "scripts/process_smoke.py")], "process-smoke.txt", ALPHA, env)
    run(
        [sys.executable, str(ALPHA / "scripts/phase3_process_smoke.py")],
        "phase3-process-smoke.txt",
        ALPHA,
        env,
    )
    with tempfile.TemporaryDirectory(prefix="studyseat-phase3-") as temporary:
        directory = Path(temporary)
        for script in (
            "browser.cjs",
            "account-switch.cjs",
            "reservations-browser.cjs",
            "initialization-browser.cjs",
            "reservation-list-browser.cjs",
            "phase3-browser.cjs",
            "phase3-review-browser.cjs",
        ):
            browser_case(directory, script)
        prototype_browser(directory)
    report = {
        "result": "passed",
        "executed_at": datetime.now(timezone.utc).isoformat(),
        "python": sys.version,
        "browser_channel": os.environ.get("STUDYSEAT_BROWSER_CHANNEL", "msedge"),
        "scope": "pytest, Ruff, JS syntax, prototype tests, real restart, foundation/account-switch/reservation/initialization/reservation-list/phase3/phase3-review browsers, phase3 migration/restart/timeout process, prototype browser",
        "database_isolation": "pytest tmp_path; restart TemporaryDirectory; one fresh file per browser suite",
    }
    report["runtime"] = {
        name: importlib.metadata.version(name)
        for name in ("Flask", "Werkzeug", "pytest", "ruff", "tzdata")
    }
    report["sqlite"] = sqlite3.sqlite_version
    report["platform"] = platform.platform()
    source_files = []
    for directory in (ALPHA / "studyseat", ALPHA / "scripts", ALPHA / "tests"):
        source_files.extend(
            p
            for p in directory.rglob("*")
            if p.is_file() and p.suffix in (".py", ".sql", ".cjs", ".js", ".html", ".css")
        )
    source_files.extend(
        ALPHA / name for name in ("requirements.txt", "requirements-dev.txt", "pyproject.toml")
    )
    source_files.extend(
        ROOT / name for name in ("scripts/prepare-github.py", "tests/submission.test.cjs")
    )
    report["source_sha256"] = {
        str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(source_files)
    }
    (EVIDENCE / "verification.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        EVIDENCE.mkdir(parents=True, exist_ok=True)
        (EVIDENCE / "verification.json").write_text(
            json.dumps(
                {
                    "result": "failed",
                    "executed_at": datetime.now(timezone.utc).isoformat(),
                    "error": str(error),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        raise
