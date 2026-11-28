"""Reservation policy and atomic mutations; HTTP handlers never decide availability."""

import json
import re
import uuid
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from .auth import ApiError
from .db import get_db, write_transaction
from .policy import valid_settings

SHANGHAI = ZoneInfo("Asia/Shanghai")
ACTIVE = "('PENDING_CHECKIN','IN_USE','ON_LEAVE')"
ISO_TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})\Z")
SELECT = """SELECT r.*, s.label AS seat_label, s.room_id, rooms.name AS room_name
            FROM reservations r JOIN seats s ON s.id=r.seat_id
            JOIN rooms ON rooms.id=s.room_id"""


def now_utc():
    return datetime.now(timezone.utc)


def utc_text(value):
    return value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def interval(start_at, end_at):
    try:
        values = []
        for value in (start_at, end_at):
            if not isinstance(value, str) or not ISO_TIME.fullmatch(value):
                raise ValueError
            values.append(
                datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
            )
        if values[0] >= values[1]:
            raise ValueError
        return tuple(values)
    except (ValueError, OverflowError):
        raise ApiError(
            400, "TIME_INVALID", "请提供带时区且开始早于结束的 ISO 时间（精确到秒或微秒）。"
        ) from None


def rules(connection):
    row = connection.execute("SELECT * FROM rule_versions ORDER BY id DESC LIMIT 1").fetchone()
    if not row:
        raise ApiError(503, "NOT_INITIALIZED", "请先初始化规则。")
    try:
        settings = json.loads(row["settings_json"])
        if not valid_settings(settings):
            raise ValueError
    except (ValueError, TypeError, KeyError):
        raise ApiError(503, "RULES_UNAVAILABLE", "当前规则配置无效，请联系管理员。") from None
    return row["id"], settings


def validate_policy(resource, start, end, settings, now):
    if not resource["enabled"] or not resource["room_enabled"]:
        raise ApiError(409, "RESOURCE_UNAVAILABLE", "房间或座位未启用。")
    try:
        local_start, local_end = start.astimezone(SHANGHAI), end.astimezone(SHANGHAI)
    except OverflowError:
        raise ApiError(400, "TIME_INVALID", "时间超出北京时间可表示范围。") from None
    if start < now:
        raise ApiError(400, "TIME_INVALID", "开始时间不能早于服务端当前时间。")
    if (end - start).total_seconds() > settings["max_duration_minutes"] * 60:
        raise ApiError(400, "TIME_INVALID", "预约时长超过当前规则上限。")
    if (local_start.date() - now.astimezone(SHANGHAI).date()).days > settings["max_advance_days"]:
        raise ApiError(400, "TIME_INVALID", "开始日期超过可提前预约天数。")
    # Opening hours are local daily boundaries. 24:00 is next-day midnight;
    # a 00:00–24:00 room may span midnight without an artificial closure.
    day = local_start.date()
    while day <= local_end.date():
        midnight = datetime.combine(day, time.min, SHANGHAI)
        next_midnight = midnight + timedelta(days=1)
        part_start, part_end = max(local_start, midnight), min(local_end, next_midnight)
        if part_start < part_end and (
            part_start < midnight + timedelta(minutes=resource["opens_minute"])
            or part_end > midnight + timedelta(minutes=resource["closes_minute"])
        ):
            raise ApiError(400, "TIME_INVALID", "预约时段不在房间开放时间内。")
        day += timedelta(days=1)


def room_resource(connection, room_id):
    room = connection.execute(
        "SELECT *, enabled AS room_enabled FROM rooms WHERE id=?", (room_id,)
    ).fetchone()
    if not room:
        raise ApiError(404, "NOT_FOUND", "房间不存在。")
    return room


def seat_resource(connection, seat_id):
    seat = connection.execute(
        """SELECT s.*, r.enabled AS room_enabled, r.opens_minute, r.closes_minute
           FROM seats s JOIN rooms r ON r.id=s.room_id WHERE s.id=?""",
        (seat_id,),
    ).fetchone()
    if not seat:
        raise ApiError(404, "NOT_FOUND", "座位不存在。")
    return seat


def closed(connection, room_id, seat_id=None):
    return (
        connection.execute(
            "SELECT 1 FROM resource_closures WHERE reopened_at IS NULL AND (room_id=? OR seat_id=?)",
            (room_id, seat_id),
        ).fetchone()
        is not None
    )


def serialize(row):
    record = dict(row)
    record["rule_snapshot"] = json.loads(record.pop("rule_snapshot_json"))
    record.pop("idempotency_key")
    return record


def owned(connection, student_id, reservation_id):
    row = connection.execute(
        SELECT + " WHERE r.id=? AND r.student_id=?", (reservation_id, student_id)
    ).fetchone()
    if row is None:
        raise ApiError(404, "NOT_FOUND", "预约不存在或不可访问。")
    return serialize(row)


def list_owned(student_id):
    from .lifecycle import sweep

    sweep()
    return [
        serialize(row)
        for row in get_db().execute(
            SELECT + " WHERE r.student_id=? ORDER BY r.start_at DESC, r.id", (student_id,)
        )
    ]


def available(student_id, room_id, start_at, end_at):
    from .lifecycle import sweep

    start, end = interval(start_at, end_at)
    sweep()
    connection = get_db()
    _, settings = rules(connection)
    room = room_resource(connection, room_id)
    now = now_utc()
    validate_policy(room, start, end, settings, now)
    if closed(connection, room_id):
        raise ApiError(409, "RESOURCE_UNAVAILABLE", "房间已关闭。")
    rows = connection.execute(
        f"""SELECT s.id, s.room_id, s.label, s.enabled,
        s.enabled=1 AND NOT EXISTS (SELECT 1 FROM resource_closures c WHERE c.seat_id=s.id AND c.reopened_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM reservations r WHERE (r.seat_id=s.id OR r.student_id=?)
          AND r.status IN {ACTIVE} AND r.start_at<? AND ?<r.end_at) AS available
        FROM seats s WHERE s.room_id=? ORDER BY s.label, s.id""",
        (student_id, utc_text(end), utc_text(start), room_id),
    ).fetchall()
    return {
        "seats": [
            {key: row[key] for key in ("id", "room_id", "label")}
            for row in rows
            if row["available"]
        ],
        "seat_catalog": [
            dict(row, enabled=bool(row["enabled"]), available=bool(row["available"]))
            for row in rows
        ],
        "server_time": utc_text(now),
        "start_at": utc_text(start),
        "end_at": utc_text(end),
    }


def create(student_id, seat_id, start_at, end_at, key):
    start, end = interval(start_at, end_at)
    start_text, end_text = utc_text(start), utc_text(end)
    with write_transaction() as connection:
        from .lifecycle import reconcile

        reconcile(connection, now_utc())
        prior = connection.execute(
            "SELECT * FROM reservations WHERE student_id=? AND idempotency_key=?", (student_id, key)
        ).fetchone()
        if prior:
            if (prior["seat_id"], prior["start_at"], prior["end_at"]) != (
                seat_id,
                start_text,
                end_text,
            ):
                raise ApiError(409, "IDEMPOTENCY_CONFLICT", "此幂等键已用于不同预约内容。")
            return owned(connection, student_id, prior["id"]), False
        version, settings = rules(connection)
        resource = seat_resource(connection, seat_id)
        now = now_utc()
        validate_policy(resource, start, end, settings, now)
        if closed(connection, resource["room_id"], seat_id):
            raise ApiError(409, "RESOURCE_UNAVAILABLE", "资源已关闭。")
        conflict = connection.execute(
            f"""SELECT 1 FROM reservations WHERE (seat_id=? OR student_id=?)
              AND status IN {ACTIVE} AND start_at<? AND ?<end_at LIMIT 1""",
            (seat_id, student_id, end_text, start_text),
        ).fetchone()
        if conflict:
            raise ApiError(409, "RESERVATION_CONFLICT", "座位或本人在此时段已有预约，请重新查询。")
        reservation_id = str(uuid.uuid4())
        connection.execute(
            """INSERT INTO reservations(id,student_id,seat_id,start_at,end_at,status,
            rule_version_id,rule_snapshot_json,idempotency_key,created_at)
            VALUES (?,?,?,?,?,'PENDING_CHECKIN',?,?,?,?)""",
            (
                reservation_id,
                student_id,
                seat_id,
                start_text,
                end_text,
                version,
                json.dumps(settings, ensure_ascii=False, sort_keys=True),
                key,
                utc_text(now),
            ),
        )
        audit(connection, student_id, reservation_id, "RESERVATION_CREATED", now)
        return owned(connection, student_id, reservation_id), True


def audit(connection, student_id, reservation_id, action, now):
    connection.execute(
        """INSERT INTO audit_events(actor_id,reservation_id,action,target_id,occurred_at)
           VALUES (?,?,?,?,?)""",
        (student_id, reservation_id, action, reservation_id, utc_text(now)),
    )


def cancel(student_id, reservation_id):
    from .lifecycle import reconcile

    with write_transaction() as connection:
        record = owned(connection, student_id, reservation_id)
        if record["status"] == "CANCELLED":
            return record
        now = now_utc()
        reconcile(connection, now)
        record = owned(connection, student_id, reservation_id)
        allowed = record["status"] == "PENDING_CHECKIN"
        if allowed:
            connection.execute(
                "UPDATE reservations SET status='CANCELLED', ended_at=?,state_version=state_version+1 WHERE id=?",
                (utc_text(now), reservation_id),
            )
            audit(connection, student_id, reservation_id, "RESERVATION_CANCELLED", now)
            record = owned(connection, student_id, reservation_id)
    if not allowed:
        raise ApiError(409, "STATE_NOT_ALLOWED", "仅可取消待签到预约。")
    return record
