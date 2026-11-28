import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest

from studyseat import create_app, reservations
from studyseat.db import get_db, initialize
from studyseat.seed import seed_demo

API = "/api/v1"


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setattr(
        reservations, "now_utc", lambda: datetime(2026, 11, 28, 2, 0, tzinfo=timezone.utc)
    )
    app = create_app(
        {
            "TESTING": True,
            "DATABASE": str(tmp_path / "review.db"),
            "SECRET_KEY": "independent-review-only-secret-" * 3,
        }
    )
    with app.app_context():
        initialize()
        seed_demo()
    return app


def login(client, username="admin01", password="Admin1234"):
    csrf = client.get(API + "/auth/session").json["data"]["csrf_token"]
    result = client.post(
        API + "/auth/login",
        json={"username": username, "password": password},
        headers={"X-CSRF-Token": csrf},
    )
    assert result.status_code == 200
    return {"X-CSRF-Token": result.json["data"]["csrf_token"]}


def weekly(key, start=360):
    return {
        "weekdays": [0],
        "mode": "custom",
        "opens_minute": start,
        "closes_minute": 1320,
        "base_version": 1,
        "idempotency_key": key,
    }


def timed(client, headers):
    data = {
        "seat_id": "lib-a101:A01",
        "start_at": "2026-11-29T09:30:00+08:00",
        "end_at": "2026-11-29T10:30:00+08:00",
        "reason": "独立复查",
    }
    result = client.post(API + "/admin/closures/preview", headers=headers, json=data)
    assert result.status_code == 200
    return result.json["data"]["preview_token"]


def reserve(app):
    client = app.test_client()
    headers = login(client, "832402116", "123456")
    r = client.post(
        API + "/reservations",
        headers=headers,
        json={
            "seat_id": "lib-a101:A01",
            "start_at": "2026-11-29T09:00:00+08:00",
            "end_at": "2026-11-29T10:00:00+08:00",
            "idempotency_key": "review-reservation",
        },
    )
    assert r.status_code == 201
    return r.json["data"]["id"]


def test_two_connections_weekly_writers_only_one_version_wins(app):
    clients = [app.test_client(), app.test_client()]
    headers = [login(c) for c in clients]
    gate = threading.Barrier(2)

    def work(index):
        gate.wait(timeout=5)
        return (
            clients[index]
            .post(
                API + "/admin/rooms/lib-a101/weekly-hours",
                headers=headers[index],
                json=weekly("review-weekly-" + str(index), 360 + index * 60),
            )
            .status_code
        )

    with ThreadPoolExecutor(2) as pool:
        statuses = list(pool.map(work, range(2)))
    assert sorted(statuses) == [200, 409]
    with app.app_context():
        db = get_db()
        assert db.execute("SELECT weekly_version FROM rooms WHERE id='lib-a101'").fetchone()[0] == 2
        assert (
            db.execute(
                "SELECT COUNT(*) FROM audit_events WHERE action='ROOM_WEEKLY_HOURS_UPDATED'"
            ).fetchone()[0]
            == 1
        )


def test_weekly_audit_failure_rolls_back_schedule_and_receipt(app):
    client = app.test_client()
    headers = login(client)
    with app.app_context():
        get_db().execute(
            "CREATE TRIGGER review_fail BEFORE INSERT ON audit_events WHEN NEW.action='ROOM_WEEKLY_HOURS_UPDATED' BEGIN SELECT RAISE(ABORT,'review-audit'); END"
        )
    response = client.post(
        API + "/admin/rooms/lib-a101/weekly-hours",
        headers=headers,
        json=weekly("review-rollback-weekly"),
    )
    assert response.status_code == 503
    with app.app_context():
        db = get_db()
        assert db.execute("SELECT COUNT(*) FROM room_weekly_hours").fetchone()[0] == 0
        assert db.execute("SELECT weekly_version FROM rooms WHERE id='lib-a101'").fetchone()[0] == 1
        assert (
            db.execute(
                "SELECT COUNT(*) FROM operation_receipts WHERE idempotency_key='review-rollback-weekly'"
            ).fetchone()[0]
            == 0
        )


def test_timed_closure_audit_failure_rolls_back_cancellations(app):
    record = reserve(app)
    client = app.test_client()
    headers = login(client)
    token = timed(client, headers)
    with app.app_context():
        get_db().execute(
            "CREATE TRIGGER review_fail BEFORE INSERT ON audit_events WHEN NEW.action='RESOURCE_CLOSED' BEGIN SELECT RAISE(ABORT,'review-audit'); END"
        )
    response = client.post(
        API + "/admin/closures",
        headers=headers,
        json={"preview_token": token, "idempotency_key": "review-rollback-close"},
    )
    assert response.status_code == 503
    with app.app_context():
        db = get_db()
        assert db.execute("SELECT COUNT(*) FROM resource_closures").fetchone()[0] == 0
        row = db.execute(
            "SELECT status,state_version FROM reservations WHERE id=?", (record,)
        ).fetchone()
        assert tuple(row) == ("PENDING_CHECKIN", 0)
        assert (
            db.execute(
                "SELECT COUNT(*) FROM audit_events WHERE action='RESERVATION_CANCELLED_BY_CLOSURE'"
            ).fetchone()[0]
            == 0
        )
        assert (
            db.execute(
                "SELECT COUNT(*) FROM operation_receipts WHERE idempotency_key='review-rollback-close'"
            ).fetchone()[0]
            == 0
        )


def test_two_connections_timed_close_only_one_audit_and_cancel(app):
    record = reserve(app)
    clients = [app.test_client(), app.test_client()]
    headers = [login(c) for c in clients]
    tokens = [timed(c, h) for c, h in zip(clients, headers)]
    gate = threading.Barrier(2)

    def work(index):
        gate.wait(timeout=5)
        return (
            clients[index]
            .post(
                API + "/admin/closures",
                headers=headers[index],
                json={
                    "preview_token": tokens[index],
                    "idempotency_key": "review-close-" + str(index),
                },
            )
            .status_code
        )

    with ThreadPoolExecutor(2) as pool:
        statuses = list(pool.map(work, range(2)))
    assert sorted(statuses) == [200, 409]
    with app.app_context():
        db = get_db()
        assert db.execute("SELECT COUNT(*) FROM resource_closures").fetchone()[0] == 1
        assert (
            db.execute(
                "SELECT COUNT(*) FROM audit_events WHERE action='RESOURCE_CLOSED'"
            ).fetchone()[0]
            == 1
        )
        assert (
            db.execute(
                "SELECT COUNT(*) FROM audit_events WHERE action='RESERVATION_CANCELLED_BY_CLOSURE'"
            ).fetchone()[0]
            == 1
        )
        assert (
            db.execute("SELECT status FROM reservations WHERE id=?", (record,)).fetchone()[0]
            == "CANCELLED"
        )
