"""Real v1 migration, HTTP restart and independent timeout-worker verification."""

import http.cookiejar
import json
import os
import secrets
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from studyseat import create_app  # noqa: E402
from studyseat.db import get_db  # noqa: E402
from studyseat.seed import DEFAULT_RULES, seed_demo  # noqa: E402


def main():
    with tempfile.TemporaryDirectory(prefix="studyseat-phase3-process-") as directory:
        database = str(Path(directory) / "phase3.sqlite3")
        secret = secrets.token_hex(32)
        env = dict(
            os.environ,
            STUDYSEAT_DATABASE=database,
            STUDYSEAT_SECRET_KEY=secret,
            STUDYSEAT_HTTPS="0",
        )
        app = create_app({"DATABASE": database, "SECRET_KEY": secret})
        now = datetime.now(timezone.utc)

        def text(value):
            return value.isoformat(timespec="microseconds").replace("+00:00", "Z")

        with app.app_context():
            db = get_db()
            db.executescript((ROOT / "studyseat/schema.sql").read_text())
            db.execute("PRAGMA user_version=1")
            db.execute("INSERT INTO schema_versions VALUES (1,?)", (text(now),))
            seed_demo()
            db.execute(
                "INSERT INTO reservations(id,student_id,seat_id,start_at,end_at,status,rule_version_id,rule_snapshot_json,idempotency_key,created_at) VALUES ('v1-reservation','student01','activity-24:A01',?,?,'PENDING_CHECKIN',1,?,'legacy-request',?)",
                (
                    text(now + timedelta(minutes=2)),
                    text(now + timedelta(hours=1)),
                    json.dumps(DEFAULT_RULES),
                    text(now),
                ),
            )
            db.execute(
                "INSERT INTO audit_events(actor_id,reservation_id,action,target_id,occurred_at) VALUES ('student01','v1-reservation','RESERVATION_CREATED','v1-reservation',?)",
                (text(now),),
            )
        migrated = subprocess.run(
            [sys.executable, "-m", "flask", "--app", "studyseat", "init-db", "--demo"],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
        )
        assert migrated.returncode == 0, migrated.stdout + migrated.stderr
        with closing(sqlite3.connect(database)) as db, db:
            assert db.execute("PRAGMA user_version").fetchone()[0] == 3
            assert db.execute("SELECT COUNT(*) FROM reservations").fetchone()[0] == 1
            assert db.execute("SELECT action,details_json FROM audit_events").fetchone() == (
                "RESERVATION_CREATED",
                "{}",
            )
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}/api/v1"
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
        )

        def request(path, body=None, csrf=None):
            headers = {"Content-Type": "application/json"}
            if csrf:
                headers["X-CSRF-Token"] = csrf
            req = urllib.request.Request(
                base + path,
                data=json.dumps(body).encode() if body is not None else None,
                headers=headers,
            )
            with opener.open(req, timeout=3) as response:
                return json.load(response)["data"]

        def start():
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
                cwd=ROOT,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            try:
                for _ in range(100):
                    try:
                        request("/health")
                        return process
                    except (OSError, urllib.error.URLError):
                        if process.poll() is not None:
                            raise RuntimeError("Service exited")
                        time.sleep(0.1)
                raise RuntimeError("Startup timed out")
            except Exception:
                process.terminate()
                process.wait(timeout=10)
                raise

        first = start()
        try:
            csrf = request("/auth/session")["csrf_token"]
            csrf = request("/auth/login", {"username": "832402116", "password": "123456"}, csrf)[
                "csrf_token"
            ]
            checked = request(
                "/reservations/v1-reservation/check-in", {"idempotency_key": "checkin"}, csrf
            )
            left = request(
                "/reservations/v1-reservation/leave",
                {"idempotency_key": "leave", "expected_version": checked["state_version"]},
                csrf,
            )
            assert left["status"] == "ON_LEAVE"
        finally:
            first.terminate()
            first.wait(timeout=10)
        second = start()
        try:
            assert first.pid != second.pid
            assert request("/me")["id"] == "student01"
            assert request("/reservations/v1-reservation") == left
            assert (
                request(
                    "/reservations/v1-reservation/leave",
                    {"idempotency_key": "leave", "expected_version": checked["state_version"]},
                    csrf,
                )
                == left
            )
            returned = request(
                "/reservations/v1-reservation/return",
                {"idempotency_key": "return", "expected_version": left["state_version"]},
                csrf,
            )
            assert returned["status"] == "IN_USE"
            done = request(
                "/reservations/v1-reservation/finish", {"idempotency_key": "finish"}, csrf
            )
            assert (
                request("/reservations/v1-reservation/finish", {"idempotency_key": "finish"}, csrf)
                == done
            )
        finally:
            second.terminate()
            second.wait(timeout=10)
        # The service is now stopped. Seed an explicitly past-due fixture and run
        # the independent CLI process; no browser or HTTP read triggers this.
        with closing(sqlite3.connect(database)) as db, db:
            db.execute(
                "INSERT INTO reservations(id,student_id,seat_id,start_at,end_at,status,rule_version_id,rule_snapshot_json,idempotency_key,created_at) VALUES ('worker-fixture','student02','activity-24:A02',?,?,'PENDING_CHECKIN',1,?,'worker',?)",
                (
                    text(now - timedelta(minutes=16)),
                    text(now + timedelta(hours=1)),
                    json.dumps(DEFAULT_RULES),
                    text(now),
                ),
            )
        command = [sys.executable, "-m", "flask", "--app", "studyseat", "expire-reservations"]
        a = subprocess.Popen(
            command, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        b = subprocess.Popen(
            command, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        outputs = [a.communicate(timeout=15), b.communicate(timeout=15)]
        assert a.returncode == b.returncode == 0, outputs
        with closing(sqlite3.connect(database)) as db, db:
            assert (
                db.execute("SELECT status FROM reservations WHERE id='worker-fixture'").fetchone()[
                    0
                ]
                == "EXPIRED"
            )
            assert (
                db.execute(
                    "SELECT COUNT(*) FROM audit_events WHERE action='CHECKIN_EXPIRED'"
                ).fetchone()[0]
                == 1
            )
            assert (
                db.execute(
                    "SELECT COUNT(*) FROM audit_events WHERE action='CHECKED_IN'"
                ).fetchone()[0]
                == 1
            )
            assert (
                db.execute(
                    "SELECT COUNT(*) FROM audit_events WHERE action='RESERVATION_FINISHED'"
                ).fetchone()[0]
                == 1
            )
        report = {
            "result": "passed",
            "executed_at": datetime.now(timezone.utc).isoformat(),
            "service_pids": [first.pid, second.pid],
            "worker_pids": [a.pid, b.pid],
            "checks": [
                "real v1 reservation/audit migrated to v3 without loss",
                "HTTP checkin/leave",
                "session and leave state survive service restart",
                "same leave key retains original deadline after restart",
                "return/finish/replay",
                "two independent timeout CLI processes while service stopped",
                "one timeout and one audit",
            ],
            "worker_outputs": [output[0].strip() for output in outputs],
        }
        target = (
            Path(os.environ.get("STUDYSEAT_EVIDENCE_DIR", str(ROOT / "evidence/phase3/restart")))
            / "phase3-process-smoke.json"
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
