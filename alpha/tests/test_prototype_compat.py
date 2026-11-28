"""Compatibility contracts required by the real prototype pages."""

from datetime import datetime, timedelta, timezone

import pytest
from conftest import login

from studyseat import reservations
from studyseat.db import get_db

ROOM = "lib-a101"
API = "/api/v1"
NOW = datetime(2026, 11, 23, 0, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(reservations, "now_utc", lambda: NOW)


def auth(client, username="832402116", password="123456"):
    return {"X-CSRF-Token": login(client, username, password).json["data"]["csrf_token"]}


def query(client, start="2026-11-24T08:00:00+08:00", end="2026-11-24T09:00:00+08:00", room=ROOM):
    return client.get(
        API + "/seats", query_string={"room_id": room, "start_at": start, "end_at": end}
    )


def booking(client, headers, **changes):
    return client.post(
        API + "/reservations",
        headers=headers,
        json={
            "seat_id": f"{ROOM}:A01",
            "start_at": "2026-11-24T08:00:00+08:00",
            "end_at": "2026-11-24T09:00:00+08:00",
            "idempotency_key": "book",
            **changes,
        },
    )


def weekly(client, headers, room=ROOM, **changes):
    return client.post(
        f"{API}/admin/rooms/{room}/weekly-hours",
        headers=headers,
        json={
            "weekdays": [1],
            "mode": "closed",
            "base_version": 1,
            "idempotency_key": "weekly",
            **changes,
        },
    )


def test_weekly_schedule_permissions_conflicts_and_old_daily_api(app, client):
    student = auth(client)
    assert weekly(client, student).status_code == 403
    admin = app.test_client()
    headers = auth(admin, "admin01", "Admin1234")
    reserved = booking(client, student)
    assert reserved.status_code == 201
    assert weekly(admin, headers).json["error"]["code"] == "RESERVATIONS_AFFECTED"
    assert (
        client.post(
            f"{API}/reservations/{reserved.json['data']['id']}/cancel", headers=student
        ).status_code
        == 200
    )
    saved = weekly(admin, headers)
    assert saved.status_code == 200
    assert saved.json["data"]["weekly_hours"][1] == [None, None]
    assert weekly(admin, headers).json == saved.json
    assert (
        weekly(admin, headers, idempotency_key="other").json["error"]["code"] == "RESOURCE_CHANGED"
    )
    assert query(client).status_code == 400
    assert booking(client, student, idempotency_key="next").status_code == 400
    assert (
        query(client, "2026-11-25T08:00:00+08:00", "2026-11-25T09:00:00+08:00").status_code == 200
    )
    result = admin.post(
        f"{API}/admin/rooms/{ROOM}/hours",
        headers=headers,
        json={
            "opens_minute": 540,
            "closes_minute": 1320,
            "base_hours": [480, 1320],
            "idempotency_key": "daily",
        },
    )
    assert result.status_code == 200
    room = next(r for r in client.get(API + "/rooms").json["data"] if r["id"] == ROOM)
    assert room["weekly_hours"][1:3] == [[None, None], [540, 1320]]
    assert room["weekly_version"] == 3


def test_weekly_all_day_and_midnight_exclusive(app, client):
    auth(client)
    admin = app.test_client()
    headers = auth(admin, "admin01", "Admin1234")
    assert weekly(admin, headers, weekdays=[0], mode="all_day").status_code == 200
    assert weekly(admin, headers, base_version=2, idempotency_key="closed").status_code == 200
    assert (
        query(client, "2026-11-23T23:00:00+08:00", "2026-11-24T00:00:00+08:00").status_code == 200
    )
    assert (
        query(client, "2026-11-23T23:00:00+08:00", "2026-11-24T00:01:00+08:00").status_code == 400
    )


def test_scheduled_closure_half_open_interval_and_reopen(app, client):
    student = auth(client)
    booked = booking(client, student).json["data"]
    admin = app.test_client()
    headers = auth(admin, "admin01", "Admin1234")
    closure = {
        "seat_id": f"{ROOM}:A01",
        "reason": "定期维护",
        "start_at": "2026-11-24T08:30:00+08:00",
        "end_at": "2026-11-24T09:30:00+08:00",
    }
    preview = admin.post(API + "/admin/closures/preview", headers=headers, json=closure).json[
        "data"
    ]
    assert preview["mode"] == "scheduled"
    assert [record["id"] for record in preview["affected"]] == [booked["id"]]
    assert (
        client.get(f"{API}/reservations/{booked['id']}").json["data"]["status"] == "PENDING_CHECKIN"
    )
    closed = admin.post(
        API + "/admin/closures",
        headers=headers,
        json={"preview_token": preview["preview_token"], "idempotency_key": "scheduled"},
    )
    assert closed.status_code == 200
    result = closed.json["data"]
    assert result["start_at"] == "2026-11-24T00:30:00.000000Z"
    assert client.get(f"{API}/reservations/{booked['id']}").json["data"]["status"] == "CANCELLED"
    assert query(client).json["data"]["seat_catalog"][0]["available"] is False
    assert query(client, "2026-11-24T09:30:00+08:00", "2026-11-24T10:00:00+08:00").json["data"][
        "seat_catalog"
    ][0]["available"]
    assert (
        booking(client, student, idempotency_key="blocked").json["error"]["code"]
        == "RESOURCE_UNAVAILABLE"
    )
    opened = admin.post(
        f"{API}/admin/closures/{result['id']}/reopen",
        headers=headers,
        json={"idempotency_key": "open"},
    )
    assert opened.status_code == 200
    assert booking(client, student, idempotency_key="after-open").status_code == 201
    assert client.get(f"{API}/reservations/{booked['id']}").json["data"]["status"] == "CANCELLED"


def test_scheduled_preview_cannot_confirm_after_end(app, monkeypatch):
    admin = app.test_client()
    headers = auth(admin, "admin01", "Admin1234")
    response = admin.post(
        API + "/admin/closures/preview",
        headers=headers,
        json={
            "room_id": ROOM,
            "reason": "短时维护",
            "start_at": "2026-11-23T08:00:00+08:00",
            "end_at": "2026-11-23T08:05:00+08:00",
        },
    )
    assert response.status_code == 200
    monkeypatch.setattr(reservations, "now_utc", lambda: NOW + timedelta(minutes=5))
    failed = admin.post(
        API + "/admin/closures",
        headers=headers,
        json={
            "preview_token": response.json["data"]["preview_token"],
            "idempotency_key": "expired",
        },
    )
    assert failed.json["error"]["code"] == "PREVIEW_STALE"
    with app.app_context():
        assert get_db().execute("SELECT COUNT(*) FROM resource_closures").fetchone()[0] == 0
