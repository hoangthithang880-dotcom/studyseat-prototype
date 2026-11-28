"""Measure real local HTTP traffic; this is not a production capacity claim."""

import http.cookiejar
import json
import math
import os
import sqlite3
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode

from werkzeug.serving import WSGIRequestHandler, make_server

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studyseat import create_app  # noqa: E402
from studyseat.db import get_db, initialize  # noqa: E402
from studyseat.seed import seed_demo  # noqa: E402


class Quiet(WSGIRequestHandler):
    def log_request(self, *args, **kwargs):
        pass


def request(opener, url, body=None, csrf=None):
    headers = {"Content-Type": "application/json"}
    if csrf:
        headers["X-CSRF-Token"] = csrf
    req = urllib.request.Request(
        url, data=json.dumps(body).encode() if body is not None else None, headers=headers
    )
    start = time.perf_counter()
    try:
        response = opener.open(req, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.code, json.load(response), (time.perf_counter() - start) * 1000


def run_batch(name, workers, jobs, operation):
    barrier = threading.Barrier(workers)

    def work(index):
        if index < workers:
            barrier.wait(timeout=20)
        return operation(index)

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(work, range(jobs)))
    seconds = time.perf_counter() - started
    latency = sorted(row[2] for row in results)
    return {
        "name": name,
        "workers": workers,
        "requests": jobs,
        "seconds": round(seconds, 3),
        "requests_per_second": round(jobs / seconds, 2),
        "p50_ms": round(latency[math.ceil(jobs * 0.50) - 1], 2),
        "p95_ms": round(latency[math.ceil(jobs * 0.95) - 1], 2),
        "max_ms": round(max(latency), 2),
        "http_status": dict(Counter(str(row[0]) for row in results)),
    }, results


def main():
    out = Path(
        os.environ.get(
            "STUDYSEAT_EVIDENCE_DIR",
            Path(__file__).resolve().parents[1] / "evidence/phase4-integration",
        )
    ).resolve()
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="phase4-load-") as temporary:
        database = str(Path(temporary) / "load.db")
        app = create_app({"DATABASE": database, "SECRET_KEY": "isolated-perf-secret-" * 3})
        with app.app_context():
            initialize()
            seed_demo()
            connection = get_db()
            password_hash = connection.execute(
                "SELECT password_hash FROM users WHERE id='student01'"
            ).fetchone()[0]
            for index in range(20):
                connection.execute(
                    "INSERT INTO users(id,username,display_name,password_hash,role) VALUES(?,?,?,?,?)",
                    (f"load{index}", f"load{index}", f"Load {index}", password_hash, "student"),
                )
        server = make_server("127.0.0.1", 0, app, threaded=True, request_handler=Quiet)
        server.request_queue_size = 128
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f"http://127.0.0.1:{server.server_port}"
        clients = []
        try:
            for index in range(20):
                opener = urllib.request.build_opener(
                    urllib.request.ProxyHandler({}),
                    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
                )
                csrf = request(opener, origin + "/api/v1/auth/session")[1]["data"]["csrf_token"]
                status, data, _ = request(
                    opener,
                    origin + "/api/v1/auth/login",
                    {"username": f"load{index}", "password": "123456"},
                    csrf,
                )
                assert status == 200
                clients.append((opener, data["data"]["csrf_token"]))
            day = (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
            payload = {
                "seat_id": "lib-a101:A01",
                "start_at": day + "T10:00:00+08:00",
                "end_at": day + "T11:00:00+08:00",
                "idempotency_key": "load-request",
            }
            query = urlencode(
                {
                    "room_id": "lib-a101",
                    "start_at": payload["start_at"],
                    "end_at": payload["end_at"],
                }
            )
            reports = []
            for workers in (1, 10, 20):
                report, results = run_batch(
                    "seat-query",
                    workers,
                    100,
                    lambda i: request(clients[i % 20][0], origin + "/api/v1/seats?" + query),
                )
                assert all(row[0] == 200 for row in results)
                reports.append(report)

            def compete(index):
                opener, csrf = clients[index]
                return request(opener, origin + "/api/v1/reservations", payload, csrf)

            report, results = run_batch("same-seat-competition", 20, 20, compete)
            assert sum(row[0] == 201 for row in results) == 1
            assert sum(row[0] == 409 for row in results) == 19
            reports.append(report)
            with closing(sqlite3.connect(database)) as connection:
                assert connection.execute("SELECT COUNT(*) FROM reservations").fetchone()[0] == 1
                assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            result = {
                "executed_at": datetime.now(timezone.utc).isoformat(),
                "transport": "loopback HTTP, threaded Werkzeug, SQLite WAL file, independent sessions",
                "scope": "312 seeded seats; 20 synthetic students; login excluded; one run per load level",
                "limits": "Not production WSGI, not Internet latency, not a 100-user capacity acceptance test",
                "reports": reports,
                "database_reservations": 1,
                "integrity_check": "ok",
            }
            (out / "performance.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
            print(json.dumps(result, indent=2))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    main()
