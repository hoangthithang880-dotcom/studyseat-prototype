"""Real API state boundaries, shared management data, rollback and lock races."""

import json
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from conftest import login

from studyseat import create_app, lifecycle, reservations
from studyseat.db import SCHEMA_VERSION, get_db, initialize, write_transaction

BASE = "/api/v1"
START = datetime(2026, 11, 25, 2, 0, tzinfo=timezone.utc)


@pytest.fixture
def clock(monkeypatch):
    value = [START - timedelta(hours=1)]
    monkeypatch.setattr(reservations, "now_utc", lambda: value[0])
    return value


def auth(client, admin=False, other=False):
    args = ("admin01", "Admin1234") if admin else (("student02", "Study1234") if other else ())
    return {"X-CSRF-Token": login(client, *args).json["data"]["csrf_token"]}


def book(client, headers, **changes):
    response = client.post(
        BASE + "/reservations",
        headers=headers,
        json={
            "seat_id": "lib-a101:A01",
            "start_at": reservations.utc_text(START),
            "end_at": reservations.utc_text(START + timedelta(hours=2)),
            "idempotency_key": "book-1",
            **changes,
        },
    )
    assert response.status_code == 201, response.json
    return response.json["data"]


def act(client, headers, record, action, key=None):
    key = key or action
    body = {"idempotency_key": key}
    if action in ("leave", "return"):
        with client.application.app_context():
            db = get_db()
            receipt = db.execute(
                "SELECT payload_json FROM operation_receipts WHERE actor_id=? AND idempotency_key=? AND operation=?",
                (record["student_id"], key, action),
            ).fetchone()
            # Replays retain their original precondition; new commands observe current state.
            body["expected_version"] = (
                json.loads(receipt[0])["expected_version"]
                if receipt
                else db.execute(
                    "SELECT state_version FROM reservations WHERE id=?", (record["id"],)
                ).fetchone()[0]
            )
    return client.post(BASE + f"/reservations/{record['id']}/{action}", headers=headers, json=body)


def admin_post(client, headers, path, **body):
    return client.post(BASE + "/admin/" + path, headers=headers, json=body)


def rows(app, table):
    with app.app_context():
        return [dict(row) for row in get_db().execute(f"SELECT * FROM {table}")]


def audit_count(app, action):
    return sum(row["action"] == action for row in rows(app, "audit_events"))


@pytest.mark.parametrize(
    "offset,allowed", [(-601, False), (-600, True), (0, True), (900, True), (900.000001, False)]
)
def test_checkin_both_endpoints_and_no_show(client, app, clock, offset, allowed):
    headers = auth(client)
    record = book(client, headers)
    clock[0] = START + timedelta(seconds=offset)
    response = act(client, headers, record, "check-in")
    assert response.status_code == (200 if allowed else 409)
    actual = client.get(BASE + "/reservations/" + record["id"]).json["data"]
    assert actual["status"] == (
        "IN_USE" if allowed else ("EXPIRED" if offset > 900 else "PENDING_CHECKIN")
    )
    if offset > 900:
        assert actual["ended_at"] == reservations.utc_text(START + timedelta(minutes=15))
        assert audit_count(app, "CHECKIN_EXPIRED") == 1


def test_leave_return_multiple_cycles_and_old_retries(client, app, clock):
    headers = auth(client)
    record = book(client, headers)
    clock[0] = START
    first = act(client, headers, record, "check-in").json["data"]
    clock[0] += timedelta(minutes=1)
    left = act(client, headers, record, "leave", "leave-1").json["data"]
    assert left["leave_deadline"] == reservations.utc_text(clock[0] + timedelta(minutes=30))
    clock[0] += timedelta(minutes=30)
    assert act(client, headers, record, "return", "return-1").json["data"]["status"] == "IN_USE"
    left2 = act(client, headers, record, "leave", "leave-2").json["data"]
    assert left2["leave_started_at"] != left["leave_started_at"]
    assert act(client, headers, record, "return", "return-1").json["data"]["status"] == "ON_LEAVE"
    assert (
        act(client, headers, record, "check-in").json["data"]["checked_in_at"]
        == first["checked_in_at"]
    )
    assert act(client, headers, record, "leave", "leave-1").json["data"] == left2
    assert act(client, headers, record, "return", "return-2").status_code == 200
    done = act(client, headers, record, "finish").json["data"]
    clock[0] += timedelta(minutes=1)
    assert act(client, headers, record, "finish", "finish-new").json["data"] == done
    assert act(client, headers, record, "leave", "leave-new").status_code == 409
    assert act(client, headers, record, "check-in", "check-in-new").json["data"] == done
    assert audit_count(app, "CHECKED_IN") == 1
    assert audit_count(app, "LEFT_SEAT") == 2
    assert audit_count(app, "RETURNED") == 2
    assert audit_count(app, "RESERVATION_FINISHED") == 1


@pytest.mark.parametrize("mode", ["no-show", "leave-expiry", "natural", "leave-natural", "tie"])
def test_timeout_cli_repetition_and_effective_end(client, app, clock, mode):
    headers = auth(client)
    record = book(client, headers)
    clock[0] = START
    if mode != "no-show":
        assert act(client, headers, record, "check-in").status_code == 200
    if mode in ("leave-expiry", "leave-natural", "tie"):
        clock[0] = START + timedelta(
            minutes={"leave-expiry": 0, "leave-natural": 115, "tie": 90}[mode]
        )
        assert act(client, headers, record, "leave").status_code == 200
    clock[0] = START + timedelta(hours=5)
    result = app.test_cli_runner().invoke(args=["expire-reservations"])
    assert result.exit_code == 0 and "Reconciled 1" in result.output
    assert "Reconciled 0" in app.test_cli_runner().invoke(args=["expire-reservations"]).output
    actual = client.get(BASE + "/reservations/" + record["id"]).json["data"]
    expected_status = "EXPIRED" if mode in ("no-show", "leave-expiry") else "COMPLETED"
    minutes = {"no-show": 15, "leave-expiry": 30}.get(mode, 120)
    assert actual["status"] == expected_status
    assert actual["ended_at"] == reservations.utc_text(START + timedelta(minutes=minutes))
    assert act(client, headers, record, "return", "late-return").status_code == 409
    assert (
        len(
            [
                x
                for x in rows(app, "audit_events")
                if json.loads(x["details_json"]).get("source") == "timeout"
            ]
        )
        == 1
    )


@pytest.mark.parametrize("action", ["check-in", "leave", "return", "finish"])
def test_transition_access_csrf_and_invalid_state(client, app, clock, action):
    headers = auth(client)
    record = book(client, headers)
    path = BASE + f"/reservations/{record['id']}/{action}"
    anonymous = app.test_client()
    assert anonymous.post(path).status_code == 401
    other = app.test_client()
    other_headers = auth(other, other=True)
    assert act(other, other_headers, record, action).status_code == 404
    assert client.post(path, json={"idempotency_key": "x"}).status_code == 403
    assert client.post(path, headers=headers, json={}).status_code == 400
    admin = app.test_client()
    assert act(admin, auth(admin, admin=True), record, action).status_code == 403
    if action != "check-in":
        assert act(client, headers, record, action).status_code == 409


@pytest.mark.parametrize(
    "action,setup,event",
    [
        ("check-in", [], "CHECKED_IN"),
        ("leave", ["check-in"], "LEFT_SEAT"),
        ("return", ["check-in", "leave"], "RETURNED"),
        ("finish", ["check-in"], "RESERVATION_FINISHED"),
    ],
)
def test_lifecycle_audit_failure_rolls_back(client, app, clock, action, setup, event):
    headers = auth(client)
    record = book(client, headers)
    clock[0] = START
    for step in setup:
        assert act(client, headers, record, step).status_code == 200
    before = rows(app, "reservations")
    receipts = rows(app, "operation_receipts")
    with app.app_context(), write_transaction() as db:
        db.execute(
            f"CREATE TRIGGER fail_event BEFORE INSERT ON audit_events WHEN NEW.action='{event}' BEGIN SELECT RAISE(ABORT,'injected'); END"
        )
    assert act(client, headers, record, action).status_code == 503
    assert rows(app, "reservations") == before
    assert rows(app, "operation_receipts") == receipts


def test_rules_shared_snapshots_optimistic_versions_and_replays(client, app, clock):
    headers = auth(client)
    record = book(client, headers)
    admin = app.test_client()
    ah = auth(admin, admin=True)
    current = client.get(BASE + "/rules").json["data"]
    settings = dict(current["settings"], check_in_early_minutes=1, leave_limit_minutes=2)
    payload = {"settings": settings, "base_version": 1, "idempotency_key": "rules-1"}
    saved = admin_post(admin, ah, "rules", **payload)
    assert saved.status_code == 200 and saved.json["data"]["version"] == 2
    assert client.get(BASE + "/rules").json["data"] == saved.json["data"]
    assert admin_post(admin, ah, "rules", **payload).json == saved.json
    assert (
        admin_post(admin, ah, "rules", **dict(payload, idempotency_key="stale")).status_code == 409
    )
    assert (
        admin_post(
            admin, ah, "rules", **dict(payload, base_version=2, idempotency_key="noop")
        ).status_code
        == 200
    )
    assert audit_count(app, "RULES_UPDATED") == 1
    clock[0] = START - timedelta(minutes=10)
    actual = act(client, headers, record, "check-in").json["data"]
    assert actual["rule_version_id"] == 1
    assert actual["rule_snapshot"]["leave_limit_minutes"] == 30
    assert act(client, headers, record, "leave").json["data"][
        "leave_deadline"
    ] == reservations.utc_text(clock[0] + timedelta(minutes=30))
    for invalid in (
        dict(settings, leave_limit_minutes=True),
        dict(settings, leave_limit_minutes=0),
        {},
        dict(settings, extra=1),
    ):
        assert (
            admin_post(
                admin, ah, "rules", settings=invalid, base_version=2, idempotency_key="bad"
            ).status_code
            == 400
        )


def preview(admin, ah, **changes):
    response = admin_post(
        admin, ah, "closures/preview", seat_id="lib-a101:A01", reason="设备检修", **changes
    )
    assert response.status_code == 200, response.json
    return response.json["data"]


def close(admin, ah, result, key="close-1"):
    return admin_post(
        admin, ah, "closures", preview_token=result["preview_token"], idempotency_key=key
    )


def test_preview_read_only_close_shared_cancel_reopen_no_revive(client, app, clock):
    headers = auth(client)
    record = book(client, headers)
    admin = app.test_client()
    ah = auth(admin, admin=True)
    before = {
        table: rows(app, table)
        for table in ("reservations", "resource_closures", "audit_events", "operation_receipts")
    }
    result = preview(admin, ah)
    assert [x["id"] for x in result["affected"]] == [record["id"]]
    assert not result["blockers"]
    assert before == {table: rows(app, table) for table in before}
    response = close(admin, ah, result)
    assert response.status_code == 200
    closure = response.json["data"]
    assert close(admin, ah, result).json == response.json
    actual = client.get(BASE + "/reservations/" + record["id"]).json["data"]
    assert actual["status"] == "CANCELLED"
    assert admin.get(BASE + "/admin/reservations").json["data"] == [actual]
    assert (
        client.post(
            BASE + "/reservations",
            headers=headers,
            json={
                "seat_id": "lib-a101:A01",
                "start_at": reservations.utc_text(START),
                "end_at": reservations.utc_text(START + timedelta(hours=1)),
                "idempotency_key": "blocked",
            },
        ).status_code
        == 409
    )
    opened = admin_post(admin, ah, f"closures/{closure['id']}/reopen", idempotency_key="reopen-1")
    assert opened.status_code == 200
    assert (
        admin_post(admin, ah, f"closures/{closure['id']}/reopen", idempotency_key="reopen-2").json
        == opened.json
    )
    assert client.get(BASE + "/reservations/" + record["id"]).json["data"] == actual
    book(client, headers, idempotency_key="new")
    assert audit_count(app, "RESOURCE_CLOSED") == 1
    assert audit_count(app, "RESOURCE_REOPENED") == 1


@pytest.mark.parametrize("change", ["new-reservation", "checkin", "resource", "tamper"])
def test_stale_closure_preview_rejected(client, app, clock, change):
    headers = auth(client)
    record = book(client, headers)
    admin = app.test_client()
    ah = auth(admin, admin=True)
    result = preview(admin, ah)
    if change == "new-reservation":
        book(
            client,
            headers,
            start_at=reservations.utc_text(START + timedelta(hours=3)),
            end_at=reservations.utc_text(START + timedelta(hours=4)),
            idempotency_key="later",
        )
    elif change == "checkin":
        clock[0] = START
        act(client, headers, record, "check-in")
    elif change == "resource":
        with app.app_context(), write_transaction() as db:
            db.execute("UPDATE seats SET enabled=0 WHERE id='lib-a101:A01'")
    else:
        result["preview_token"] += "tamper"
    assert close(admin, ah, result).status_code == 409
    assert not rows(app, "resource_closures")
    assert audit_count(app, "RESOURCE_CLOSED") == 0


@pytest.mark.parametrize("leave", [False, True])
def test_active_use_blocks_close_even_fresh_preview(client, app, clock, leave):
    headers = auth(client)
    record = book(client, headers)
    clock[0] = START
    act(client, headers, record, "check-in")
    if leave:
        act(client, headers, record, "leave")
    admin = app.test_client()
    ah = auth(admin, admin=True)
    result = preview(admin, ah)
    assert len(result["blockers"]) == 1
    assert close(admin, ah, result).json["error"]["code"] == "RESOURCE_IN_USE"
    assert not rows(app, "resource_closures")


def test_closure_failure_rolls_back_all_records(client, app, clock):
    headers = auth(client)
    record = book(client, headers)
    admin = app.test_client()
    ah = auth(admin, admin=True)
    result = preview(admin, ah)
    with app.app_context(), write_transaction() as db:
        db.execute(
            "CREATE TRIGGER fail_closure BEFORE INSERT ON audit_events WHEN NEW.action='RESOURCE_CLOSED' BEGIN SELECT RAISE(ABORT,'injected'); END"
        )
    assert close(admin, ah, result).status_code == 503
    assert not rows(app, "resource_closures")
    assert (
        client.get(BASE + "/reservations/" + record["id"]).json["data"]["status"]
        == "PENDING_CHECKIN"
    )
    assert audit_count(app, "RESERVATION_CANCELLED_BY_CLOSURE") == 0


@pytest.mark.parametrize(
    "path", ["rules", "closures/preview", "closures", "closures/x/reopen", "rooms/lib-a101/hours"]
)
def test_admin_writes_require_role_and_csrf(client, app, clock, path):
    assert admin_post(client, {}, path).status_code == 401
    headers = auth(client)
    assert admin_post(client, headers, path).status_code == 403
    admin = app.test_client()
    auth(admin, admin=True)
    assert admin_post(admin, {}, path).status_code == 403


def test_opening_hours_reject_affected_reservations_and_concurrent_edit(client, app, clock):
    headers = auth(client)
    book(client, headers)
    admin = app.test_client()
    ah = auth(admin, admin=True)
    payload = {
        "opens_minute": 11 * 60,
        "closes_minute": 22 * 60,
        "base_hours": [480, 1320],
        "idempotency_key": "hours-1",
    }
    assert (
        admin_post(admin, ah, "rooms/lib-a101/hours", **payload).json["error"]["code"]
        == "RESERVATIONS_AFFECTED"
    )
    payload["opens_minute"] = 9 * 60
    assert admin_post(admin, ah, "rooms/lib-a101/hours", **payload).status_code == 200
    assert (
        admin_post(
            admin, ah, "rooms/lib-a101/hours", **dict(payload, idempotency_key="hours-stale")
        ).status_code
        == 409
    )
    room = next(x for x in client.get(BASE + "/rooms").json["data"] if x["id"] == "lib-a101")
    assert room["opens_minute"] == 540


def test_migration_v1_is_additive_and_repeated_initialization_safe(tmp_path):
    filename = str(tmp_path / "old.sqlite3")
    db = sqlite3.connect(filename)
    db.executescript((Path(__file__).parents[1] / "studyseat/schema.sql").read_text())
    db.execute("INSERT INTO schema_versions VALUES (1,'old')")
    db.execute("INSERT INTO users VALUES ('old','old','old','hash','student',1)")
    db.execute("INSERT INTO persistence_notes VALUES ('note','old','retained','old')")
    db.execute("PRAGMA user_version=1")
    db.commit()
    db.close()
    app = create_app({"TESTING": True, "SECRET_KEY": "test-migration-" * 3, "DATABASE": filename})
    with app.app_context():
        initialize()
        initialize()
        db = get_db()
        assert db.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert db.execute("SELECT content FROM persistence_notes").fetchone()[0] == "retained"
        assert db.execute("SELECT COUNT(*) FROM schema_versions").fetchone()[0] == SCHEMA_VERSION


def test_independent_connections_checkin_and_timeout_race(client, app, clock):
    headers = auth(client)
    record = book(client, headers)
    clock[0] = START + timedelta(minutes=15, microseconds=1)
    barrier = threading.Barrier(2)

    def checkin():
        barrier.wait(timeout=10)
        return act(client, headers, record, "check-in").status_code

    def timeout():
        barrier.wait(timeout=10)
        with app.app_context():
            return lifecycle.sweep()

    with ThreadPoolExecutor(max_workers=2) as executor:
        a, b = executor.submit(checkin), executor.submit(timeout)
        assert a.result(timeout=15) == 409
        b.result(timeout=15)
    assert rows(app, "reservations")[0]["status"] == "EXPIRED"
    assert audit_count(app, "CHECKIN_EXPIRED") == 1
    assert audit_count(app, "CHECKED_IN") == 0


@pytest.mark.parametrize("offset,status", [(0, "IN_USE"), (0.000001, "EXPIRED")])
def test_leave_deadline_equality_and_strict_timeout(client, app, clock, offset, status):
    headers = auth(client)
    record = book(client, headers)
    clock[0] = START
    act(client, headers, record, "check-in")
    act(client, headers, record, "leave")
    clock[0] = START + timedelta(minutes=30, seconds=offset)
    response = act(client, headers, record, "return")
    assert response.status_code == (200 if status == "IN_USE" else 409)
    assert client.get(BASE + "/reservations/" + record["id"]).json["data"]["status"] == status


def test_timeout_releases_remaining_seat_and_student_overlap(client, app, clock):
    headers = auth(client)
    book(client, headers)
    clock[0] = START + timedelta(minutes=15, microseconds=1)
    other = app.test_client()
    oh = auth(other, other=True)
    replacement = book(
        other, oh, start_at=reservations.utc_text(clock[0]), idempotency_key="released"
    )
    assert replacement["status"] == "PENDING_CHECKIN"
    assert rows(app, "reservations")[0]["status"] == "EXPIRED"


@pytest.mark.parametrize(
    "race",
    [
        "duplicate-checkin",
        "duplicate-finish",
        "duplicate-close",
        "checkin-vs-close",
        "booking-vs-close",
        "duplicate-timeout",
    ],
)
def test_independent_phase3_writers(app, client, clock, race):
    headers = auth(client)
    record = None if race == "booking-vs-close" else book(client, headers)
    admin1, admin2 = app.test_client(), app.test_client()
    ah1, ah2 = auth(admin1, admin=True), auth(admin2, admin=True)
    result = preview(admin1, ah1) if "close" in race else None
    if race in ("duplicate-checkin", "duplicate-finish", "checkin-vs-close"):
        clock[0] = START
    if race == "duplicate-finish":
        act(client, headers, record, "check-in")
    if race == "duplicate-timeout":
        clock[0] = START + timedelta(minutes=16)
    barrier = threading.Barrier(2)
    connection_ids = []
    trace = []
    real_get_db = get_db

    def run(index):
        with app.app_context():
            db = real_get_db()
            connection_ids.append(id(db))
            db.set_trace_callback(trace.append)
            barrier.wait(timeout=10)
            if race == "duplicate-timeout":
                return lifecycle.sweep()
            if race == "duplicate-close":
                return close(admin1 if index == 0 else admin2, ah1 if index == 0 else ah2, result)
            if race == "checkin-vs-close":
                return (
                    act(client, headers, record, "check-in")
                    if index == 0
                    else close(admin1, ah1, result)
                )
            if race == "booking-vs-close":
                if index == 0:
                    return client.post(
                        BASE + "/reservations",
                        headers=headers,
                        json={
                            "seat_id": "lib-a101:A01",
                            "start_at": reservations.utc_text(START),
                            "end_at": reservations.utc_text(START + timedelta(hours=1)),
                            "idempotency_key": "race-book",
                        },
                    )
                return close(admin1, ah1, result)
            return act(
                client, headers, record, "check-in" if race == "duplicate-checkin" else "finish"
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(run, range(2)))
    assert len(set(connection_ids)) == 2
    assert sum(sql == "BEGIN IMMEDIATE" for sql in trace) >= 2
    if race == "duplicate-timeout":
        assert sum(map(len, responses)) == 1
        assert audit_count(app, "CHECKIN_EXPIRED") == 1
    else:
        codes = sorted(response.status_code for response in responses)
        assert codes == (
            [201, 409]
            if race == "booking-vs-close" and 201 in codes
            else ([200, 409] if race in ("checkin-vs-close", "booking-vs-close") else [200, 200])
        )
        if race == "duplicate-checkin":
            assert audit_count(app, "CHECKED_IN") == 1
        if race == "duplicate-finish":
            assert audit_count(app, "RESERVATION_FINISHED") == 1
        if race == "duplicate-close":
            assert len(rows(app, "resource_closures")) == 1
        if race == "checkin-vs-close":
            actual = rows(app, "reservations")[0]
            assert (actual["status"], len(rows(app, "resource_closures"))) in (
                ("IN_USE", 0),
                ("CANCELLED", 1),
            )
    print(
        json.dumps(
            {
                "scenario": race,
                "independent_connections": len(set(connection_ids)),
                "write_transactions": sum(sql == "BEGIN IMMEDIATE" for sql in trace),
                "responses": [response.status_code for response in responses]
                if race != "duplicate-timeout"
                else [len(x) for x in responses],
            },
            sort_keys=True,
        )
    )


def test_timeout_audit_failure_rolls_back_and_retries(client, app, clock):
    headers = auth(client)
    book(client, headers)
    clock[0] = START + timedelta(minutes=16)
    with app.app_context(), write_transaction() as db:
        db.execute(
            "CREATE TRIGGER fail_expire BEFORE INSERT ON audit_events WHEN NEW.action='CHECKIN_EXPIRED' BEGIN SELECT RAISE(ABORT,'injected'); END"
        )
    assert app.test_cli_runner().invoke(args=["expire-reservations"]).exit_code != 0
    assert rows(app, "reservations")[0]["status"] == "PENDING_CHECKIN"
    with app.app_context(), write_transaction() as db:
        db.execute("DROP TRIGGER fail_expire")
    assert app.test_cli_runner().invoke(args=["expire-reservations"]).exit_code == 0
    assert rows(app, "reservations")[0]["status"] == "EXPIRED"


def test_operation_keys_are_bound_to_actor_action_and_record(client, app, clock):
    headers = auth(client)
    record = book(client, headers)
    clock[0] = START
    assert act(client, headers, record, "check-in", "shared-key").status_code == 200
    assert act(client, headers, record, "leave", "shared-key").status_code == 409
    later = book(
        client,
        headers,
        start_at=reservations.utc_text(START + timedelta(hours=3)),
        end_at=reservations.utc_text(START + timedelta(hours=4)),
        idempotency_key="later",
    )
    assert (
        act(client, headers, later, "check-in", "shared-key").json["error"]["code"]
        == "IDEMPOTENCY_CONFLICT"
    )


def test_room_closure_cancels_only_target_pending_and_does_not_revive(client, app, clock):
    headers = auth(client)
    first = book(client, headers)
    other = app.test_client()
    oh = auth(other, other=True)
    second = book(other, oh, seat_id="lib-a101:A02")
    outside = book(
        client,
        headers,
        seat_id="east-b203:A01",
        start_at=reservations.utc_text(START + timedelta(hours=3)),
        end_at=reservations.utc_text(START + timedelta(hours=4)),
        idempotency_key="outside",
    )
    admin = app.test_client()
    ah = auth(admin, admin=True)
    previewed = admin_post(
        admin, ah, "closures/preview", room_id="lib-a101", reason="整间检修"
    ).json["data"]
    assert {row["id"] for row in previewed["affected"]} == {first["id"], second["id"]}
    assert close(admin, ah, previewed).status_code == 200
    actual = {row["id"]: row["status"] for row in rows(app, "reservations")}
    assert actual == {
        first["id"]: "CANCELLED",
        second["id"]: "CANCELLED",
        outside["id"]: "PENDING_CHECKIN",
    }


def test_migration_error_rolls_back_v1_database(tmp_path, monkeypatch):
    filename = str(tmp_path / "broken-migration.sqlite3")
    db = sqlite3.connect(filename)
    db.executescript((Path(__file__).parents[1] / "studyseat/schema.sql").read_text())
    db.execute("INSERT INTO schema_versions VALUES (1,'old')")
    db.execute("PRAGMA user_version=1")
    db.commit()
    db.close()
    original = Path.read_text

    def invalid_migration(path, *args, **kwargs):
        if path.name == "002_phase3.sql":
            return "CREATE TABLE partial(id TEXT); INVALID SQL;"
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", invalid_migration)
    app = create_app({"TESTING": True, "SECRET_KEY": "migration-secret-" * 3, "DATABASE": filename})
    with app.app_context():
        with pytest.raises(sqlite3.DatabaseError):
            initialize()
        db = get_db()
        assert db.execute("PRAGMA user_version").fetchone()[0] == 1
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='partial'").fetchone()


@pytest.mark.parametrize("action", ["check-in", "cancel"])
def test_waiting_student_writer_uses_time_after_lock(app, client, clock, monkeypatch, action):
    from contextlib import contextmanager

    headers = auth(client)
    record = book(client, headers)
    clock[0] = START + timedelta(minutes=15)
    ready = threading.Event()
    module = lifecycle if action == "check-in" else reservations
    original = module.write_transaction

    @contextmanager
    def waiting():
        ready.set()
        with original() as connection:
            yield connection

    monkeypatch.setattr(module, "write_transaction", waiting)
    with app.app_context():
        db = get_db()
        db.execute("BEGIN IMMEDIATE")
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(act, client, headers, record, action)
            assert ready.wait(timeout=5)
            clock[0] += timedelta(microseconds=1)
            db.commit()
            assert future.result(timeout=10).status_code == 409
    assert rows(app, "reservations")[0]["status"] == "EXPIRED"
    assert audit_count(app, "CHECKIN_EXPIRED") == 1


@pytest.mark.parametrize("mutation", ["null", "boolean", "missing", "too-large"])
def test_corrupt_current_rules_reject_booking_before_bad_snapshot(client, app, clock, mutation):
    headers = auth(client)
    with app.app_context(), write_transaction() as db:
        row = db.execute("SELECT settings_json FROM rule_versions WHERE id=1").fetchone()
        settings = json.loads(row[0])
        if mutation == "missing":
            del settings["leave_limit_minutes"]
        else:
            settings["leave_limit_minutes"] = {"null": None, "boolean": True, "too-large": 1441}[
                mutation
            ]
        db.execute("UPDATE rule_versions SET settings_json=?", (json.dumps(settings),))
    response = client.post(
        BASE + "/reservations",
        headers=headers,
        json={
            "seat_id": "lib-a101:A01",
            "start_at": reservations.utc_text(START),
            "end_at": reservations.utc_text(START + timedelta(hours=1)),
            "idempotency_key": "bad",
        },
    )
    assert response.status_code == 503
    assert not rows(app, "reservations")


def test_concurrent_initializers_recheck_schema_under_lock(tmp_path, monkeypatch):
    filename = str(tmp_path / "concurrent-initialize.sqlite3")
    raw = sqlite3.connect(filename)
    raw.executescript((Path(__file__).parents[1] / "studyseat/schema.sql").read_text())
    raw.execute("INSERT INTO schema_versions VALUES (1,'old')")
    raw.execute("PRAGMA user_version=1")
    raw.commit()
    raw.close()
    app = create_app({"TESTING": True, "SECRET_KEY": "migration-secret-" * 3, "DATABASE": filename})
    barrier = threading.Barrier(2)
    original = Path.read_text

    def synchronize_schema_read(path, *args, **kwargs):
        content = original(path, *args, **kwargs)
        if path.name == "schema.sql":
            barrier.wait(timeout=10)
        return content

    monkeypatch.setattr(Path, "read_text", synchronize_schema_read)

    def upgrade(_):
        with app.app_context():
            initialize()
            return get_db().execute("PRAGMA user_version").fetchone()[0]

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert list(executor.map(upgrade, range(2))) == [SCHEMA_VERSION, SCHEMA_VERSION]
    with app.app_context():
        assert (
            get_db().execute("SELECT COUNT(*) FROM schema_versions").fetchone()[0] == SCHEMA_VERSION
        )


@pytest.mark.parametrize(
    "field,value", [("seat_id", "\ud800"), ("reason", "\ud800"), ("reason", "\x00")]
)
def test_invalid_closure_text_returns_400(client, clock, field, value):
    headers = auth(client, admin=True)
    body = {"seat_id": "lib-a101:A01", "reason": "test", field: value}
    assert admin_post(client, headers, "closures/preview", **body).status_code == 400


def test_creation_replay_returns_reconciled_current_status(client, app, clock):
    headers = auth(client)
    record = book(client, headers)
    clock[0] = START + timedelta(minutes=16)
    replayed = client.post(
        BASE + "/reservations",
        headers=headers,
        json={
            "seat_id": record["seat_id"],
            "start_at": record["start_at"],
            "end_at": record["end_at"],
            "idempotency_key": "book-1",
        },
    )
    assert replayed.status_code == 200
    assert replayed.json["data"]["status"] == "EXPIRED"
    assert audit_count(app, "CHECKIN_EXPIRED") == 1
