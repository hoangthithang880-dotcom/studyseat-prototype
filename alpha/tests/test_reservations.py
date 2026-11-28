"""Phase 2 policy, ownership, durability, rollback and real SQLite contention."""

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from conftest import login

from studyseat import create_app, reservations
from studyseat.db import get_db, write_transaction

BASE = "/api/v1/reservations"
NOW = datetime(2026, 11, 23, 0, 0, tzinfo=timezone.utc)


def payload(**changes):
    return {
        "seat_id": "lib-a101:A01",
        "start_at": "2026-11-24T08:00:00+08:00",
        "end_at": "2026-11-24T09:00:00+08:00",
        "idempotency_key": "request-1",
        **changes,
    }


@pytest.fixture(autouse=True)
def frozen_time(monkeypatch):
    monkeypatch.setattr(reservations, "now_utc", lambda: NOW)


def student(client, username="832402116", password="123456"):
    return {"X-CSRF-Token": login(client, username, password).json["data"]["csrf_token"]}


def post(client, headers, **changes):
    return client.post(BASE, json=payload(**changes), headers=headers)


def query(client, **changes):
    body = payload(**changes)
    return client.get(
        "/api/v1/seats",
        query_string={
            "room_id": "lib-a101",
            "start_at": body["start_at"],
            "end_at": body["end_at"],
        },
    )


def count(app, table, where="1=1"):
    with app.app_context():
        return get_db().execute(f"SELECT COUNT(*) FROM {table} WHERE {where}").fetchone()[0]


def test_query_create_durability_and_cancel_release(app, client):
    headers = student(client)
    initial = query(client).json["data"]
    assert len(initial["seats"]) == 119  # Seed's disabled seat never appears.
    assert initial["server_time"].endswith("Z")
    response = post(client, headers, student_id="student02", role="admin")
    assert response.status_code == 201
    record = response.json["data"]
    assert record["student_id"] == "student01"
    assert record["start_at"] == "2026-11-24T00:00:00.000000Z"
    assert record["rule_version_id"] == 1
    assert record["rule_snapshot"]["max_duration_minutes"] == 240
    assert query(client).json["data"]["seats"] == []  # Own cross-seat overlap.
    restarted = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": app.config["SECRET_KEY"],
            "DATABASE": app.config["DATABASE"],
        }
    )
    fresh = restarted.test_client()
    fresh.set_cookie("studyseat_alpha", client.get_cookie("studyseat_alpha").value)
    assert fresh.get(BASE).json["data"] == [record]
    assert fresh.get(BASE + "/" + record["id"]).json["data"] == record
    fresh_headers = student(
        fresh
    )  # New login and new server-side session still see the same record.
    assert fresh.get(BASE).json["data"] == [record]
    other = app.test_client()
    other_headers = student(other, "student02", "Study1234")
    assert other.get(BASE).json["data"] == []
    assert len(query(other).json["data"]["seats"]) == 118
    assert other.get(BASE + "/" + record["id"]).status_code == 404
    assert (
        other.post(BASE + "/" + record["id"] + "/cancel", headers=other_headers).status_code == 404
    )
    assert (
        fresh.post(BASE + "/" + record["id"] + "/cancel", headers=fresh_headers).status_code == 200
    )
    assert len(query(other).json["data"]["seats"]) == 119
    assert post(other, other_headers).status_code == 201


@pytest.mark.parametrize(
    "path,method",
    [
        (BASE, "get"),
        (BASE, "post"),
        (BASE + "/x", "get"),
        (BASE + "/x/cancel", "post"),
        ("/api/v1/seats", "get"),
    ],
)
def test_auth_and_student_role(client, path, method):
    assert getattr(client, method)(path).status_code == 401
    student(client, "admin01", "Admin1234")
    assert getattr(client, method)(path).status_code == 403


def test_csrf_and_invalid_body(client):
    headers = student(client)
    assert post(client, {}).status_code == 403
    assert client.post(BASE + "/x/cancel").status_code == 403
    for body in (
        [],
        {},
        payload(idempotency_key=""),
        payload(seat_id=3),
        payload(idempotency_key="\ud800"),
    ):
        assert client.post(BASE, json=body, headers=headers).status_code == 400
    assert query(client, start_at="2026-11-24T00:00:00").status_code == 400


@pytest.mark.parametrize(
    "changes,code",
    [
        ({"start_at": "2026-11-22T23:59:59Z"}, 400),
        ({"end_at": "2026-11-24T12:00:00.000001+08:00"}, 400),
        ({"start_at": "2026-12-01T08:00:00+08:00", "end_at": "2026-12-01T09:00:00+08:00"}, 400),
        ({"start_at": "2026-11-24T07:59:59+08:00"}, 400),
        (
            {"start_at": "2026-11-24T21:00:00+08:00", "end_at": "2026-11-24T22:00:00.000001+08:00"},
            400,
        ),
        ({"end_at": "2026-11-24T08:00:00+08:00"}, 400),
        ({"start_at": "2026-11-24T09:00:00+08:00"}, 400),
        ({"start_at": "2026-11-24T08:00:00"}, 400),
        ({"start_at": "2026-11-24"}, 400),
        ({"start_at": "2026-11-24T08:00:00+99:00"}, 400),
        ({"seat_id": "missing"}, 404),
        ({"seat_id": "lib-a101:D30"}, 409),
    ],
)
def test_invalid_time_and_resource_boundaries(client, changes, code):
    headers = student(client)
    assert post(client, headers, **changes).status_code == code
    if "seat_id" not in changes:
        assert query(client, **changes).status_code == code
    assert client.get(BASE).json["data"] == []


@pytest.mark.parametrize(
    "changes",
    [
        {"start_at": "2026-11-23T08:00:00+08:00", "end_at": "2026-11-23T12:00:00+08:00"},
        {"start_at": "2026-11-30T18:00:00+08:00", "end_at": "2026-11-30T22:00:00+08:00"},
        {
            "seat_id": "activity-24:A01",
            "start_at": "2026-11-24T23:00:00+08:00",
            "end_at": "2026-11-25T01:00:00+08:00",
        },
        {"start_at": "2026-11-24T21:00:00+08:00", "end_at": "2026-11-24T22:00:00+08:00"},
    ],
)
def test_inclusive_policy_boundaries(client, changes):
    assert post(client, student(client), **changes).status_code == 201


def test_advance_days_use_shanghai_calendar(client, monkeypatch):
    monkeypatch.setattr(
        reservations, "now_utc", lambda: datetime(2026, 11, 22, 16, 0, tzinfo=timezone.utc)
    )
    assert (
        post(
            client,
            student(client),
            start_at="2026-11-30T21:00:00+08:00",
            end_at="2026-11-30T22:00:00+08:00",
        ).status_code
        == 201
    )


@pytest.mark.parametrize("target", ["room", "seat", "room-closure", "seat-closure"])
def test_resource_disabled_or_closed(app, client, target):
    headers = student(client)
    with app.app_context(), write_transaction() as db:
        if target == "room":
            db.execute("UPDATE rooms SET enabled=0 WHERE id='lib-a101'")
        elif target == "seat":
            db.execute("UPDATE seats SET enabled=0 WHERE id='lib-a101:A01'")
        else:
            db.execute(
                "INSERT INTO resource_closures(id,room_id,seat_id,reason,created_by,created_at) VALUES ('c',?,?, 'test','admin01','now')",
                (
                    "lib-a101" if target == "room-closure" else None,
                    "lib-a101:A01" if target == "seat-closure" else None,
                ),
            )
    assert post(client, headers).status_code == 409
    response = query(client)
    if target.startswith("room"):
        assert response.status_code == 409
    else:
        assert "lib-a101:A01" not in [s["id"] for s in response.json["data"]["seats"]]


def test_overlap_and_adjacency(client, app):
    headers = student(client)
    assert post(client, headers).status_code == 201
    other = app.test_client()
    other_headers = student(other, "student02", "Study1234")
    for user, token, seat in (
        (client, headers, "lib-a101:A02"),
        (other, other_headers, "lib-a101:A01"),
    ):
        conflict = post(
            user,
            token,
            seat_id=seat,
            idempotency_key="overlap",
            start_at="2026-11-24T00:59:59Z",
            end_at="2026-11-24T02:00:00Z",
        )
        assert conflict.status_code == 409
        assert conflict.json["error"]["code"] == "RESERVATION_CONFLICT"
        assert (
            post(
                user,
                token,
                seat_id=seat,
                idempotency_key="adjacent",
                start_at="2026-11-24T01:00:00Z",
                end_at="2026-11-24T02:00:00Z",
            ).status_code
            == 201
        )


def test_idempotency_normalized_payload_and_cancel(app, client, monkeypatch):
    headers = student(client)
    first = post(client, headers).json["data"]
    replay = post(client, headers, start_at="2026-11-24T00:00:00Z", end_at="2026-11-24T01:00:00Z")
    assert replay.status_code == 200 and replay.json["data"] == first
    assert post(client, headers, seat_id="lib-a101:A02").status_code == 409
    assert count(app, "reservations") == 1
    assert count(app, "audit_events", "action='RESERVATION_CREATED'") == 1
    path = BASE + "/" + first["id"] + "/cancel"
    cancelled = client.post(path, headers=headers).json["data"]
    monkeypatch.setattr(reservations, "now_utc", lambda: NOW + timedelta(days=20))
    assert client.post(path, headers=headers).json["data"] == cancelled
    assert post(client, headers).json["data"] == cancelled  # Replay never revives or revalidates.
    assert count(app, "audit_events", "action='RESERVATION_CANCELLED'") == 1


@pytest.mark.parametrize("status", ["IN_USE", "ON_LEAVE", "COMPLETED", "EXPIRED"])
def test_cancel_rejects_other_states(app, client, status):
    headers = student(client)
    record = post(client, headers).json["data"]
    with app.app_context(), write_transaction() as db:
        db.execute(
            "UPDATE reservations SET status=?,leave_deadline='2026-11-24T00:30:00.000000Z' WHERE id=?",
            (status, record["id"]),
        )
    assert client.post(BASE + "/" + record["id"] + "/cancel", headers=headers).status_code == 409
    assert count(app, "audit_events", "action='RESERVATION_CANCELLED'") == 0


@pytest.mark.parametrize("days,minutes", [(1, 0), (1, 15), (2, 0)])
def test_pending_cancel_reconciles_deadlines(client, monkeypatch, days, minutes):
    headers = student(client)
    record = post(client, headers).json["data"]
    monkeypatch.setattr(
        reservations, "now_utc", lambda: NOW + timedelta(days=days, minutes=minutes)
    )
    response = client.post(BASE + "/" + record["id"] + "/cancel", headers=headers)
    assert response.status_code == (409 if days == 2 else 200)
    if days == 2:
        assert client.get(BASE + "/" + record["id"]).json["data"]["status"] == "EXPIRED"


def test_rule_snapshot_and_latest_rule(app, client):
    headers = student(client)
    record = post(client, headers).json["data"]
    with app.app_context(), write_transaction() as db:
        settings = dict(record["rule_snapshot"], max_duration_minutes=30, max_advance_days=1)
        db.execute("INSERT INTO rule_versions VALUES(2,?,'admin01','now')", (json.dumps(settings),))
    assert (
        post(
            client,
            headers,
            idempotency_key="new",
            start_at="2026-11-25T08:00:00+08:00",
            end_at="2026-11-25T08:30:00+08:00",
        ).status_code
        == 400
    )
    assert (
        post(
            client,
            headers,
            idempotency_key="new",
            start_at="2026-11-24T10:00:00+08:00",
            end_at="2026-11-24T11:00:00+08:00",
        ).status_code
        == 400
    )
    new = post(
        client,
        headers,
        idempotency_key="new",
        start_at="2026-11-24T10:00:00+08:00",
        end_at="2026-11-24T10:30:00+08:00",
    ).json["data"]
    assert new["rule_version_id"] == 2
    assert client.get(BASE + "/" + record["id"]).json["data"] == record


@pytest.mark.parametrize("action", ["RESERVATION_CREATED", "RESERVATION_CANCELLED"])
def test_audit_failure_rolls_back_entire_mutation(app, client, action):
    headers = student(client)
    record = post(client, headers).json["data"] if action.endswith("CANCELLED") else None
    with app.app_context(), write_transaction() as db:
        db.execute(
            f"CREATE TRIGGER reject_event BEFORE INSERT ON audit_events WHEN NEW.action='{action}' BEGIN SELECT RAISE(ABORT,'injected'); END"
        )
    response = (
        client.post(BASE + "/" + record["id"] + "/cancel", headers=headers)
        if record
        else post(client, headers)
    )
    assert response.status_code == 503
    assert count(app, "audit_events", f"action='{action}'") == 0
    assert count(app, "reservations") == (1 if record else 0)
    if record:
        assert client.get(BASE + "/" + record["id"]).json["data"] == record
    with app.app_context(), write_transaction() as db:
        db.execute("DROP TRIGGER reject_event")
    retry = (
        client.post(BASE + "/" + record["id"] + "/cancel", headers=headers)
        if record
        else post(client, headers)
    )
    assert retry.status_code == (200 if record else 201)


@pytest.mark.parametrize(
    "race", ["same-seat", "same-student", "same-key", "different-payload-key", "same-cancel"]
)
def test_independent_connections_compete_atomically(app, monkeypatch, race):
    clients = [app.test_client(), app.test_client()]
    headers = [
        student(clients[0]),
        student(
            clients[1],
            *(("student02", "Study1234") if race == "same-seat" else ("832402116", "123456")),
        ),
    ]
    record = post(clients[0], headers[0]).json["data"] if race == "same-cancel" else None
    barrier = threading.Barrier(2)
    connection_ids = []
    trace = []
    real_transaction = reservations.write_transaction

    @contextmanager
    def synchronized_transaction():
        db = get_db()
        connection_ids.append(id(db))
        db.set_trace_callback(lambda sql: trace.append(sql))
        barrier.wait(timeout=10)
        with real_transaction() as connection:
            yield connection

    monkeypatch.setattr(reservations, "write_transaction", synchronized_transaction)

    def compete(i):
        if record:
            return clients[i].post(BASE + "/" + record["id"] + "/cancel", headers=headers[i])
        changes = {"idempotency_key": f"race-{i}"}
        if race in ("same-key", "different-payload-key"):
            changes["idempotency_key"] = "race-key"
        if race in ("same-student", "different-payload-key"):
            changes["seat_id"] = f"lib-a101:A0{i + 1}"
        return post(clients[i], headers[i], **changes)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(compete, range(2)))
    expected = [200, 200] if record else ([200, 201] if race == "same-key" else [201, 409])
    assert sorted(r.status_code for r in results) == expected
    assert len(set(connection_ids)) == 2
    assert sum(s == "BEGIN IMMEDIATE" for s in trace) == 2
    assert count(app, "reservations") == 1
    assert count(app, "audit_events", "action='RESERVATION_CREATED'") == 1
    if record:
        assert results[0].json == results[1].json
        assert count(app, "audit_events", "action='RESERVATION_CANCELLED'") == 1
    if race == "different-payload-key":
        assert (
            next(r for r in results if r.status_code == 409).json["error"]["code"]
            == "IDEMPOTENCY_CONFLICT"
        )

    print(
        json.dumps(
            {
                "scenario": race,
                "responses": sorted(r.status_code for r in results),
                "independent_connections": len(set(connection_ids)),
                "begin_immediate_count": 2,
                "reservation_count": 1,
                "create_audit_count": 1,
                "cancel_audit_count": 1 if record else 0,
            },
            sort_keys=True,
        )
    )


def test_rule_and_resource_validation_are_inside_transaction(app, client, monkeypatch):
    headers = student(client)
    original = reservations.validate_policy

    def check(*args):
        assert get_db().in_transaction
        return original(*args)

    monkeypatch.setattr(reservations, "validate_policy", check)
    assert post(client, headers).status_code == 201


@pytest.mark.parametrize(
    "status", ["PENDING_CHECKIN", "IN_USE", "ON_LEAVE", "COMPLETED", "EXPIRED", "CANCELLED"]
)
def test_only_active_states_block_seat(app, client, status):
    headers = student(client)
    post(client, headers)
    with app.app_context(), write_transaction() as db:
        db.execute(
            "UPDATE reservations SET status=?,leave_deadline='2026-11-24T00:30:00.000000Z'",
            (status,),
        )
    other = app.test_client()
    other_headers = student(other, "student02", "Study1234")
    expected = 409 if status in ("PENDING_CHECKIN", "IN_USE", "ON_LEAVE") else 201
    assert post(other, other_headers).status_code == expected


def test_missing_room_and_rules(client, app):
    headers = student(client)
    assert (
        client.get(
            "/api/v1/seats",
            query_string={
                "room_id": "unknown",
                "start_at": payload()["start_at"],
                "end_at": payload()["end_at"],
            },
        ).status_code
        == 404
    )
    with app.app_context(), write_transaction() as db:
        db.execute("DELETE FROM rule_versions")
    assert post(client, headers).status_code == 503
    assert query(client).status_code == 503


def test_waiting_writer_revalidates_changed_resource(app, client, monkeypatch):
    headers = student(client)
    ready = threading.Event()
    original = reservations.write_transaction

    @contextmanager
    def waiting():
        ready.set()
        with original() as db:
            yield db

    monkeypatch.setattr(reservations, "write_transaction", waiting)
    with app.app_context():
        db = get_db()
        db.execute("BEGIN IMMEDIATE")
        db.execute("UPDATE rooms SET enabled=0 WHERE id='lib-a101'")
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(post, client, headers)
            try:
                assert ready.wait(timeout=5)
            finally:
                db.commit()
            assert future.result(timeout=10).status_code == 409
    assert count(app, "reservations") == 0


def test_out_of_range_local_timezone_is_input_error(client):
    headers = student(client)
    changes = {"start_at": "9999-12-31T22:00:00Z", "end_at": "9999-12-31T23:00:00Z"}
    assert post(client, headers, **changes).status_code == 400
    assert query(client, **changes).status_code == 400
    assert client.get(BASE).json["data"] == []


def test_full_seat_catalog_without_private_conflict_details(app, client):
    headers = student(client)
    key = "lib-a101:A03"
    with app.app_context(), write_transaction() as connection:
        connection.execute(
            """INSERT INTO resource_closures(id,seat_id,reason,created_by,created_at)
               VALUES ('catalog-closure',?,'检修','admin01','2026-11-23T00:00:00.000000Z')""",
            (key,),
        )
    initial = query(client).json["data"]
    catalog = initial["seat_catalog"]
    assert len(catalog) == 120
    assert initial["seats"] == [
        {k: row[k] for k in ("id", "room_id", "label")} for row in catalog if row["available"]
    ]
    assert next(row for row in catalog if row["id"] == key) == {
        "id": key,
        "room_id": "lib-a101",
        "label": "A03",
        "enabled": True,
        "available": False,
    }
    assert catalog[-1]["enabled"] is False
    created = post(client, headers).json["data"]
    overlapping = query(client).json["data"]
    assert overlapping["seats"] == []
    assert all(row["available"] is False for row in overlapping["seat_catalog"])
    other = app.test_client()
    student(other, "student02", "Study1234")
    response = query(other)
    assert response.json["data"]["seat_catalog"][0]["available"] is False
    assert created["id"] not in response.get_data(as_text=True)
    assert "student01" not in response.get_data(as_text=True)


def test_empty_room_catalog(app, client):
    student(client)
    with app.app_context(), write_transaction() as connection:
        connection.execute(
            "INSERT INTO rooms(id,name,location,opens_minute,closes_minute) VALUES ('empty','空房间','',0,1440)"
        )
    result = client.get(
        "/api/v1/seats",
        query_string={"room_id": "empty", **{k: payload()[k] for k in ("start_at", "end_at")}},
    ).json["data"]
    assert result["seats"] == result["seat_catalog"] == []
