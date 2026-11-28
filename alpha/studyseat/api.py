import uuid

from flask import Blueprint, abort, current_app, g, jsonify, render_template, request

from . import lifecycle, management, reservations
from .auth import ApiError, activate_session, authenticate, check_csrf, new_session, require_role
from .db import SCHEMA_VERSION, get_db, utc_now, write_transaction

bp = Blueprint("api", __name__)


def ok(data, status=200):
    return jsonify(data=data), status


def json_body():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError(400, "INVALID_INPUT", "请提交 JSON 对象。")
    return body


def valid_text(value, maximum):
    if not isinstance(value, str) or not 1 <= len(value) <= maximum or "\x00" in value:
        return False
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


@bp.get("/")
def index():
    return render_template("prototype.html")


@bp.get("/diagnostics")
def diagnostics():
    if not current_app.config["DIAGNOSTICS_UI"]:
        abort(404)
    return render_template("index.html")


@bp.get("/api/v1/health")
def health():
    connection = get_db()
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    recorded = connection.execute(
        "SELECT version FROM schema_versions WHERE version=?", (SCHEMA_VERSION,)
    ).fetchone()
    if version != SCHEMA_VERSION or recorded is None:
        raise ApiError(503, "DATABASE_UNAVAILABLE", "数据库版本未就绪，请检查初始化。")
    return ok({"status": "ok", "schema_version": SCHEMA_VERSION, "server_time": utc_now()})


@bp.get("/api/v1/auth/session")
def auth_session():
    if not g.auth_session:
        with write_transaction() as connection:
            token, csrf = new_session(connection)
        activate_session(token)
    else:
        csrf = g.auth_session["csrf_token"]
    return ok({"user": g.identity, "csrf_token": csrf})


@bp.post("/api/v1/auth/login")
def login():
    check_csrf()
    body = json_body()
    username, password = body.get("username"), body.get("password")
    if not valid_text(username, 100) or not valid_text(password, 256):
        raise ApiError(400, "INVALID_INPUT", "请输入账号和密码。")
    user = authenticate(username, password)
    with write_transaction() as connection:
        token, csrf = new_session(connection, user["id"])
        connection.execute(
            "INSERT INTO audit_events(actor_id,action,target_id,occurred_at) VALUES (?,?,?,?)",
            (user["id"], "LOGIN", user["id"], utc_now()),
        )
    activate_session(token)
    return ok({"user": user, "csrf_token": csrf})


@bp.post("/api/v1/auth/logout")
@require_role()
def logout():
    check_csrf()
    with write_transaction() as connection:
        token, csrf = new_session(connection)
    activate_session(token)
    return ok({"user": None, "csrf_token": csrf})


@bp.get("/api/v1/me")
@require_role()
def me():
    return ok(g.identity)


@bp.get("/api/v1/rooms")
@require_role()
def rooms():
    rows = get_db().execute(
        """SELECT r.*, COUNT(s.id) AS seat_count, (
               SELECT json_group_object(w.weekday, json_array(w.opens_minute,w.closes_minute))
               FROM room_weekly_hours w WHERE w.room_id=r.id
           ) AS weekly_json FROM rooms r LEFT JOIN seats s ON s.room_id=r.id
           GROUP BY r.id ORDER BY r.id"""
    )
    return ok([reservations.room_summary(row) for row in rows])


@bp.get("/api/v1/rules")
@require_role()
def rules():
    version, settings = reservations.rules(get_db())
    return ok({"version": version, "settings": settings})


@bp.get("/api/v1/persistence-notes")
@require_role()
def list_notes():
    rows = (
        get_db()
        .execute(
            "SELECT * FROM persistence_notes WHERE owner_id=? ORDER BY created_at DESC",
            (g.identity["id"],),
        )
        .fetchall()
    )
    return ok([dict(row) for row in rows])


@bp.post("/api/v1/persistence-notes")
@require_role()
def add_note():
    check_csrf()
    content = json_body().get("content")
    if not isinstance(content, str) or not valid_text(content.strip(), 200):
        raise ApiError(400, "INVALID_INPUT", "验证文本应为 1 至 200 个字符。")
    note = {
        "id": str(uuid.uuid4()),
        "owner_id": g.identity["id"],
        "content": content.strip(),
        "created_at": utc_now(),
    }
    with write_transaction() as connection:
        connection.execute(
            "INSERT INTO persistence_notes VALUES (:id,:owner_id,:content,:created_at)", note
        )
        connection.execute(
            "INSERT INTO audit_events(actor_id,action,target_id,occurred_at) VALUES (?,?,?,?)",
            (g.identity["id"], "PERSISTENCE_NOTE_CREATED", note["id"], note["created_at"]),
        )
    return ok(note, 201)


@bp.get("/api/v1/persistence-notes/<note_id>")
@require_role()
def get_note(note_id):
    row = (
        get_db()
        .execute(
            "SELECT * FROM persistence_notes WHERE id=? AND owner_id=?", (note_id, g.identity["id"])
        )
        .fetchone()
    )
    if row is None:
        raise ApiError(404, "NOT_FOUND", "记录不存在或不可访问。")
    return ok(dict(row))


@bp.get("/api/v1/admin/audit-events")
@require_role("admin")
def audit_events():
    rows = get_db().execute("SELECT * FROM audit_events ORDER BY id DESC LIMIT 100").fetchall()
    return ok([dict(row) for row in rows])


@bp.get("/api/v1/seats")
@require_role("student")
def available_seats():
    room_id = request.args.get("room_id")
    if not valid_text(room_id, 100):
        raise ApiError(400, "INVALID_INPUT", "请选择房间。")
    return ok(
        reservations.available(
            g.identity["id"], room_id, request.args.get("start_at"), request.args.get("end_at")
        )
    )


@bp.get("/api/v1/reservations")
@require_role("student")
def my_reservations():
    return ok(reservations.list_owned(g.identity["id"]))


@bp.get("/api/v1/reservations/<reservation_id>")
@require_role("student")
def my_reservation(reservation_id):
    reservations.owned(get_db(), g.identity["id"], reservation_id)
    lifecycle.sweep()
    return ok(reservations.owned(get_db(), g.identity["id"], reservation_id))


@bp.post("/api/v1/reservations")
@require_role("student")
def create_reservation():
    check_csrf()
    body = json_body()
    if not valid_text(body.get("seat_id"), 100) or not valid_text(body.get("idempotency_key"), 100):
        raise ApiError(400, "INVALID_INPUT", "座位和幂等键应为 1 至 100 字符。")
    record, created = reservations.create(
        g.identity["id"],
        body["seat_id"],
        body.get("start_at"),
        body.get("end_at"),
        body["idempotency_key"],
    )
    return ok(record, 201 if created else 200)


@bp.post("/api/v1/reservations/<reservation_id>/cancel")
@require_role("student")
def cancel_reservation(reservation_id):
    check_csrf()
    return ok(reservations.cancel(g.identity["id"], reservation_id))


def operation_key(body):
    key = body.get("idempotency_key")
    if not valid_text(key, 100):
        raise ApiError(400, "INVALID_INPUT", "请提交 1—100 字符的幂等操作键。")
    return key


@bp.post("/api/v1/reservations/<reservation_id>/<action>")
@require_role("student")
def reservation_action(reservation_id, action):
    check_csrf()
    if action not in ("check-in", "leave", "return", "finish"):
        raise ApiError(404, "NOT_FOUND", "操作不存在。")
    body = json_body()
    return ok(
        lifecycle.transition(
            g.identity["id"],
            reservation_id,
            action,
            operation_key(body),
            body.get("expected_version"),
        )
    )


@bp.get("/api/v1/admin/reservations")
@require_role("admin")
def admin_reservations():
    return ok(management.list_reservations(request.args.get("include") == "student"))


@bp.get("/api/v1/admin/resources")
@require_role("admin")
def admin_resources():
    return ok(management.resources())


@bp.post("/api/v1/admin/rules")
@require_role("admin")
def admin_rules():
    check_csrf()
    body = json_body()
    return ok(
        management.save_rules(
            g.identity["id"], body.get("settings"), body.get("base_version"), operation_key(body)
        )
    )


@bp.post("/api/v1/admin/closures/preview")
@require_role("admin")
def closure_preview():
    check_csrf()
    return ok(management.preview(g.identity["id"], json_body()))


@bp.post("/api/v1/admin/closures")
@require_role("admin")
def create_closure():
    check_csrf()
    body = json_body()
    return ok(management.close(g.identity["id"], body, operation_key(body)))


@bp.post("/api/v1/admin/closures/<closure_id>/reopen")
@require_role("admin")
def reopen_closure(closure_id):
    check_csrf()
    body = json_body()
    return ok(management.reopen(g.identity["id"], closure_id, operation_key(body)))


@bp.post("/api/v1/admin/rooms/<room_id>/hours")
@require_role("admin")
def admin_room_hours(room_id):
    check_csrf()
    body = json_body()
    return ok(management.save_hours(g.identity["id"], room_id, body, operation_key(body)))


@bp.post("/api/v1/admin/rooms/<room_id>/weekly-hours")
@require_role("admin")
def admin_weekly_hours(room_id):
    check_csrf()
    body = json_body()
    return ok(management.save_weekly_hours(g.identity["id"], room_id, body, operation_key(body)))
