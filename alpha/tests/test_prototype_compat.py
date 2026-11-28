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


def test_prototype_shell_and_diagnostics_opt_in(app, client, monkeypatch):
    page = client.get("/")
    assert page.status_code == 200
    assert 'type="module" src="/static/prototype.js"' in page.text
    assert "note-form" not in page.text
    assert "script-src 'self'" in page.headers["Content-Security-Policy"]
    assert client.get("/diagnostics").status_code == 404
    for asset in ("prototype.js", "prototype-admin.js", "prototype.css"):
        assert client.get(f"/static/{asset}").status_code == 200
    monkeypatch.setitem(app.config, "DIAGNOSTICS_UI", True)
    legacy = client.get("/diagnostics")
    assert legacy.status_code == 200
    assert 'id="note-form"' in legacy.text


def test_private_get_rejects_credentials_from_a_previous_tab_session(client):
    old = auth(client)["X-CSRF-Token"]
    new = auth(client, "student02", "Study1234")["X-CSRF-Token"]
    stale = client.get(API + "/reservations", headers={"X-StudySeat-Session": old})
    assert stale.status_code == 403
    assert stale.json["error"]["code"] == "CSRF_INVALID"
    assert "data" not in stale.json
    assert (
        client.get(API + "/reservations", headers={"X-StudySeat-Session": new}).status_code == 200
    )


def test_admin_can_opt_into_real_student_labels(app, client):
    student = auth(client)
    booked = booking(client, student).json["data"]
    endpoint = API + "/admin/reservations"
    assert client.get(endpoint + "?include=student").status_code == 403
    admin = app.test_client()
    auth(admin, "admin01", "Admin1234")
    assert admin.get(endpoint).json["data"] == [booked]
    (row,) = admin.get(endpoint + "?include=student").json["data"]
    assert row.pop("student_username") == "832402116"
    assert row.pop("student_name") == "申子衡"
    assert row == booked
    (own,) = client.get(API + "/reservations").json["data"]
    assert own == booked


@pytest.mark.parametrize("version", [3, 4])
def test_additive_upgrade_preserves_legacy_rows_and_rolls_back(version, tmp_path, monkeypatch):
    import sqlite3
    from contextlib import closing
    from pathlib import Path

    from studyseat import create_app
    from studyseat.db import SCHEMA_VERSION, initialize

    root = Path(reservations.__file__).parent
    database = tmp_path / "legacy.sqlite3"
    migrations = ["002_phase3.sql", "003_state_version.sql", "004_weekly_hours.sql"]
    with closing(sqlite3.connect(database)) as db:
        db.executescript((root / "schema.sql").read_text())
        for migration in migrations[: version - 1]:
            db.executescript((root / "migrations" / migration).read_text())
        db.executemany(
            "INSERT INTO schema_versions VALUES (?, 'old')", [(n,) for n in range(1, version + 1)]
        )
        db.execute(f"PRAGMA user_version={version}")
        db.execute(
            "INSERT INTO users(id,username,display_name,password_hash,role) VALUES ('legacy','legacy','原管理账号','hash','admin')"
        )
        db.execute(
            "INSERT INTO rooms(id,name,location,opens_minute,closes_minute) VALUES ('room','原教室','校区',420,1260)"
        )
        db.execute(
            "INSERT INTO resource_closures(id,room_id,reason,created_by,created_at) VALUES ('closed','room','维修','legacy','old')"
        )
        if version == 4:
            db.execute("INSERT INTO room_weekly_hours VALUES ('room',0,NULL,NULL)")
        db.commit()

    app = create_app({"DATABASE": str(database), "SECRET_KEY": "migration-test-" * 3})
    original = Path.read_text

    def break_last_migration(file, *args, **kwargs):
        text = original(file, *args, **kwargs)
        if file.name == "005_timed_closures.sql":
            return text + "\nINSERT INTO nonexistent_table VALUES(1);\n"
        return text

    with monkeypatch.context() as patch:
        patch.setattr(Path, "read_text", break_last_migration)
        with app.app_context(), pytest.raises(sqlite3.OperationalError, match="nonexistent_table"):
            initialize()

    with closing(sqlite3.connect(database)) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == version
        assert "start_at" not in [
            col[1] for col in db.execute("PRAGMA table_info(resource_closures)")
        ]
        assert db.execute("SELECT COUNT(*) FROM schema_versions").fetchone()[0] == version
        assert db.execute("SELECT reason FROM resource_closures").fetchone()[0] == "维修"
        assert bool(
            db.execute("SELECT 1 FROM sqlite_schema WHERE name='room_weekly_hours'").fetchone()
        ) == (version == 4)

    with app.app_context():
        initialize()
        initialize()
        db = get_db()
        assert db.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert tuple(
            db.execute("SELECT reason,start_at,end_at FROM resource_closures").fetchone()
        ) == ("维修", None, None)
        assert tuple(db.execute("SELECT opens_minute,closes_minute FROM rooms").fetchone()) == (
            420,
            1260,
        )
        assert db.execute("SELECT COUNT(*) FROM room_weekly_hours").fetchone()[0] == int(
            version == 4
        )


def test_scheduled_confirmation_revalidates_after_an_overlapping_booking(app, client):
    student = auth(client)
    admin = app.test_client()
    headers = auth(admin, "admin01", "Admin1234")
    body = {
        "room_id": ROOM,
        "reason": "时段检修",
        "start_at": "2026-11-24T08:30:00+08:00",
        "end_at": "2026-11-24T09:30:00+08:00",
    }
    first = admin.post(API + "/admin/closures/preview", headers=headers, json=body).json["data"]
    assert first["affected"] == []
    booked = booking(client, student).json["data"]
    rejected = admin.post(
        API + "/admin/closures",
        headers=headers,
        json={"preview_token": first["preview_token"], "idempotency_key": "stale"},
    )
    assert rejected.json["error"]["code"] == "PREVIEW_STALE"
    assert (
        client.get(f"{API}/reservations/{booked['id']}").json["data"]["status"] == "PENDING_CHECKIN"
    )
    current = admin.post(API + "/admin/closures/preview", headers=headers, json=body).json["data"]
    saved = admin.post(
        API + "/admin/closures",
        headers=headers,
        json={"preview_token": current["preview_token"], "idempotency_key": "fresh"},
    ).json["data"]
    listing = admin.get(API + "/admin/resources").json["data"]["closures"]
    assert listing[0]["id"] == saved["id"]
    assert listing[0]["affected_reservation_ids"] == [booked["id"]]
    assert listing[0]["actor_name"] == "演示管理员"
