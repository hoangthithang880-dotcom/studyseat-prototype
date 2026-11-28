"""Independent review regressions: first delayed cycle commands and watch recovery."""

import json
import os
import queue
import sqlite3
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path

import pytest
import test_phase3 as base

from studyseat import lifecycle, reservations
from studyseat.db import SCHEMA_VERSION, get_db


@pytest.fixture
def clock(monkeypatch):
    value = [base.START - timedelta(hours=1)]
    monkeypatch.setattr(reservations, "now_utc", lambda: value[0])
    return value


def current(app, record):
    with app.app_context():
        return reservations.owned(get_db(), "student01", record["id"])


def command(client, headers, record, action, key, version=None):
    body = {"idempotency_key": key}
    if action in ("leave", "return"):
        body["expected_version"] = record.get("state_version", 0) if version is None else version
    return client.post(f"/api/v1/reservations/{record['id']}/{action}", json=body, headers=headers)


@pytest.mark.parametrize("action", ["leave", "return"])
def test_first_delayed_command_cannot_change_later_cycle(app, client, clock, monkeypatch, action):
    headers = base.auth(client)
    second = app.test_client()
    second_headers = base.auth(second)
    record = base.book(client, headers)
    clock[0] = base.START
    assert command(client, headers, record, "check-in", "check").status_code == 200
    if action == "return":
        assert command(client, headers, current(app, record), "leave", "leave-1").status_code == 200
    observed = current(app, record)
    ready, release = threading.Event(), threading.Event()
    local = threading.local()
    connections = set()
    original = lifecycle.write_transaction

    @contextmanager
    def controlled():
        connections.add(id(get_db()))
        if getattr(local, "delay", False):
            ready.set()
            assert release.wait(timeout=10)
        with original() as db:
            yield db

    monkeypatch.setattr(lifecycle, "write_transaction", controlled)

    def delayed():
        local.delay = True
        return command(client, headers, observed, action, "first-delayed-key")

    with ThreadPoolExecutor(max_workers=1) as executor:
        waiting = executor.submit(delayed)
        try:
            assert ready.wait(timeout=5)
            clock[0] += timedelta(minutes=1)
            if action == "leave":
                assert (
                    command(second, second_headers, observed, "leave", "other-leave").status_code
                    == 200
                )
                assert (
                    command(
                        second, second_headers, current(app, record), "return", "other-return"
                    ).status_code
                    == 200
                )
            else:
                assert (
                    command(second, second_headers, observed, "return", "other-return").status_code
                    == 200
                )
                assert (
                    command(
                        second, second_headers, current(app, record), "leave", "leave-2"
                    ).status_code
                    == 200
                )
            before = current(app, record)
            audits = base.rows(app, "audit_events")
            receipts = base.rows(app, "operation_receipts")
        finally:
            release.set()
        response = waiting.result(timeout=10)
    assert response.status_code == 409, response.json
    assert response.json["error"]["code"] == "STALE_RESERVATION"
    assert current(app, record) == before
    assert base.rows(app, "audit_events") == audits
    assert base.rows(app, "operation_receipts") == receipts
    assert len(connections) >= 2
    print(
        json.dumps(
            {
                "race": f"first-delayed-{action}",
                "response": response.status_code,
                "independent_connections": len(connections),
                "status": before["status"],
            }
        )
    )


def test_watch_recovers_after_real_busy_timeout_without_restart(app, client, clock):
    headers = base.auth(client)
    record = base.book(client, headers)
    environment = dict(
        os.environ,
        STUDYSEAT_DATABASE=app.config["DATABASE"],
        STUDYSEAT_SECRET_KEY=app.config["SECRET_KEY"],
    )
    # Force a real past-due fixture; only the CLI may expire it after the lock is released.
    with sqlite3.connect(app.config["DATABASE"]) as db:
        db.execute(
            "UPDATE reservations SET start_at='2000-01-01T00:00:00.000000Z',end_at='2000-01-01T01:00:00.000000Z' WHERE id=?",
            (record["id"],),
        )
    blocker = sqlite3.connect(app.config["DATABASE"], isolation_level=None)
    blocker.execute("BEGIN IMMEDIATE")
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "flask",
            "--app",
            "studyseat",
            "expire-reservations",
            "--watch",
            "--interval",
            "1",
        ],
        cwd=Path(__file__).parents[1],
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    output, messages = [], queue.Queue()
    reader = threading.Thread(
        target=lambda: [messages.put(line) for line in process.stdout], daemon=True
    )
    reader.start()

    def until(text):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            try:
                line = messages.get(timeout=0.1)
                output.append(line.strip())
                if text in line:
                    return True
            except queue.Empty:
                if process.poll() is not None:
                    break
        return False

    try:
        assert until("retrying"), "\n".join(output)
        assert process.poll() is None
        assert current(app, record)["status"] == "PENDING_CHECKIN"
        blocker.rollback()
        assert until("Reconciled 1"), "\n".join(output)
        assert process.poll() is None
        assert current(app, record)["status"] == "EXPIRED"
        assert base.audit_count(app, "CHECKIN_EXPIRED") == 1
        assert until("Reconciled 0"), "\n".join(output)
        assert base.audit_count(app, "CHECKIN_EXPIRED") == 1
        print(
            json.dumps({"watch_pid": process.pid, "same_process_recovered": True, "output": output})
        )
    finally:
        blocker.rollback()
        blocker.close()
        if process.poll() is None:
            process.terminate()
        process.wait(timeout=5)
        reader.join(timeout=2)
        process.stdout.close()


def test_cycle_version_replay_payload_binding_and_frozen_clock(app, client, clock):
    headers = base.auth(client)
    record = base.book(client, headers)
    clock[0] = base.START
    checked = command(client, headers, record, "check-in", "check").json["data"]
    assert checked["state_version"] == record["state_version"] + 1
    left = command(client, headers, checked, "leave", "leave-1").json["data"]
    returned = command(client, headers, left, "return", "return-1").json["data"]
    left2 = command(client, headers, returned, "leave", "leave-2").json["data"]
    assert (
        left2["leave_started_at"] == left["leave_started_at"]
    )  # Timestamp alone cannot identify a cycle.
    assert left2["state_version"] == left["state_version"] + 2
    audit_before = base.rows(app, "audit_events")
    replay = command(client, headers, left, "return", "return-1")
    assert replay.status_code == 200 and replay.json["data"] == left2
    assert command(client, headers, checked, "leave", "leave-1").json["data"] == left2
    changed_payload = command(client, headers, left2, "return", "return-1")
    assert changed_payload.status_code == 409
    assert changed_payload.json["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert base.rows(app, "audit_events") == audit_before
    assert command(client, headers, left2, "return", "return-2").status_code == 200


@pytest.mark.parametrize("version", [None, -1, True, "1", 1.5])
def test_cyclic_precondition_requires_explicit_nonnegative_integer(app, client, clock, version):
    headers = base.auth(client)
    record = base.book(client, headers)
    clock[0] = base.START
    command(client, headers, record, "check-in", "check")
    before = current(app, record)
    body = {"idempotency_key": "invalid"}
    if version is not None:
        body["expected_version"] = version
    response = client.post(f"/api/v1/reservations/{record['id']}/leave", headers=headers, json=body)
    assert response.status_code == 400
    assert current(app, record) == before
    assert base.audit_count(app, "LEFT_SEAT") == 0


def test_two_sessions_same_cycle_only_one_new_command_writes(app, client, clock):
    headers = base.auth(client)
    second = app.test_client()
    second_headers = base.auth(second)
    record = base.book(client, headers)
    clock[0] = base.START
    checked = command(client, headers, record, "check-in", "check").json["data"]
    barrier = threading.Barrier(2)

    def leave(index):
        barrier.wait(timeout=5)
        return command(
            client if index == 0 else second,
            headers if index == 0 else second_headers,
            checked,
            "leave",
            f"racing-{index}",
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(leave, range(2)))
    assert sorted(r.status_code for r in responses) == [200, 409]
    assert current(app, record)["state_version"] == checked["state_version"] + 1
    assert base.audit_count(app, "LEFT_SEAT") == 1


def test_stale_precondition_still_commits_due_timeout(app, client, clock):
    headers = base.auth(client)
    record = base.book(client, headers)
    clock[0] = base.START
    checked = command(client, headers, record, "check-in", "check").json["data"]
    left = command(client, headers, checked, "leave", "leave-1").json["data"]
    clock[0] += timedelta(minutes=31)
    response = command(client, headers, left, "return", "first-too-late")
    assert response.status_code == 409 and response.json["error"]["code"] == "STALE_RESERVATION"
    assert current(app, record)["status"] == "EXPIRED"
    assert current(app, record)["state_version"] == left["state_version"] + 1
    assert base.audit_count(app, "LEAVE_EXPIRED") == 1


@pytest.mark.parametrize(
    "minutes,offset,allowed", [(5, -1, True), (5, 0, False), (15, -1, True), (15, 0, False)]
)
def test_short_reservation_end_priority_is_preserved(client, app, clock, minutes, offset, allowed):
    headers = base.auth(client)
    record = base.book(
        client, headers, end_at=reservations.utc_text(base.START + timedelta(minutes=minutes))
    )
    clock[0] = base.START + timedelta(minutes=minutes, microseconds=offset)
    response = command(client, headers, record, "check-in", "at-end")
    assert response.status_code == (200 if allowed else 409)
    assert current(app, record)["status"] == ("IN_USE" if allowed else "EXPIRED")


@pytest.mark.parametrize(
    "watch,error",
    [
        (True, sqlite3.OperationalError("no such table: reservations")),
        (True, sqlite3.IntegrityError("injected audit failure")),
        (False, sqlite3.OperationalError("database is locked")),
    ],
)
def test_watch_does_not_hide_permanent_or_one_shot_failures(app, monkeypatch, watch, error):
    calls = []

    def fail():
        calls.append(True)
        raise error

    monkeypatch.setattr(lifecycle, "sweep", fail)
    result = app.test_cli_runner().invoke(
        args=["expire-reservations", *(["--watch"] if watch else [])]
    )
    assert result.exit_code != 0
    assert len(calls) == 1


def v2_database(path):
    from studyseat.seed import DEFAULT_RULES

    folder = Path(__file__).parents[1] / "studyseat"
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.executescript((folder / "schema.sql").read_text())
    db.executescript((folder / "migrations/002_phase3.sql").read_text())
    db.execute("INSERT INTO schema_versions VALUES (1,'old'),(2,'old')")
    db.execute("INSERT INTO users VALUES ('old','old','old','hash','student',1)")
    db.execute("INSERT INTO rooms VALUES ('r','r','r',0,1440,1)")
    db.execute("INSERT INTO seats VALUES ('s','r','A01',1)")
    db.execute("INSERT INTO rule_versions VALUES (1,?,NULL,'old')", (json.dumps(DEFAULT_RULES),))
    db.execute(
        "INSERT INTO reservations(id,student_id,seat_id,start_at,end_at,status,rule_version_id,rule_snapshot_json,idempotency_key,created_at) VALUES ('legacy','old','s','2026-11-25T00:00:00Z','2026-11-25T01:00:00Z','IN_USE',1,?,'old','old')",
        (json.dumps(DEFAULT_RULES),),
    )
    db.execute(
        "INSERT INTO operation_receipts VALUES ('old','old-leave','leave','legacy','{\"reservation_id\":\"legacy\"}','old')"
    )
    db.execute("PRAGMA user_version=2")
    db.commit()
    db.close()


@pytest.mark.parametrize("fail", [False, True])
def test_v2_to_v3_migration_preserves_rows_or_rolls_back(tmp_path, monkeypatch, fail):
    from studyseat import create_app
    from studyseat.db import initialize

    path = tmp_path / "v2.sqlite3"
    v2_database(path)
    with sqlite3.connect(path) as db:
        old = db.execute("SELECT * FROM reservations").fetchone()
        receipt = db.execute("SELECT * FROM operation_receipts").fetchone()
    app = create_app(
        {"TESTING": True, "SECRET_KEY": "migration-secret-" * 3, "DATABASE": str(path)}
    )
    if fail:
        original = Path.read_text

        def invalid_sql(filename, *args, **kwargs):
            sql = original(filename, *args, **kwargs)
            return sql + "INVALID SQL;" if filename.name == "003_state_version.sql" else sql

        monkeypatch.setattr(Path, "read_text", invalid_sql)
    with app.app_context():
        if fail:
            with pytest.raises(sqlite3.DatabaseError):
                initialize()
        else:
            initialize()
            initialize()
        db = get_db()
        assert db.execute("PRAGMA user_version").fetchone()[0] == (2 if fail else SCHEMA_VERSION)
        actual = tuple(db.execute("SELECT * FROM reservations").fetchone())
        assert actual == (old if fail else (*old, 0))
        assert tuple(db.execute("SELECT * FROM operation_receipts").fetchone()) == receipt
        assert db.execute("SELECT COUNT(*) FROM schema_versions").fetchone()[0] == (
            2 if fail else SCHEMA_VERSION
        )
