import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from functools import wraps

from flask import g, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from .db import get_db, utc_now

# Unknown users still incur the password hashing cost.
DUMMY_HASH = generate_password_hash("unused-identity", method="scrypt")


class ApiError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def load_identity():
    g.identity = None
    g.auth_session = None
    token = session.get("sid")
    if not isinstance(token, str):
        return
    row = (
        get_db()
        .execute(
            "SELECT * FROM sessions WHERE token_hash=? AND expires_at>?",
            (token_hash(token), utc_now()),
        )
        .fetchone()
    )
    if row is None:
        session.clear()
        return
    g.auth_session = row
    if row["user_id"]:
        user = (
            get_db()
            .execute(
                "SELECT id,username,display_name,role FROM users WHERE id=? AND enabled=1",
                (row["user_id"],),
            )
            .fetchone()
        )
        g.identity = dict(user) if user else None


def new_session(connection, user_id=None):
    if g.auth_session:
        connection.execute(
            "DELETE FROM sessions WHERE token_hash=?", (g.auth_session["token_hash"],)
        )
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=8)
    connection.execute("DELETE FROM sessions WHERE expires_at<=?", (utc_now(),))
    connection.execute(
        "INSERT INTO sessions VALUES (?,?,?,?)",
        (
            token_hash(token),
            user_id,
            csrf,
            expires.isoformat(timespec="microseconds").replace("+00:00", "Z"),
        ),
    )
    return token, csrf


def activate_session(token):
    # Publish the new cookie only after the database transaction has committed.
    session.clear()
    session["sid"] = token


def check_csrf(header="X-CSRF-Token"):
    supplied = request.headers.get(header, "")
    if (
        not g.auth_session
        or not supplied.isascii()
        or not secrets.compare_digest(supplied, g.auth_session["csrf_token"])
    ):
        raise ApiError(403, "CSRF_INVALID", "页面凭据已失效，请刷新后重试。")


def require_role(role=None):
    def decorate(function):
        @wraps(function)
        def guarded(*args, **kwargs):
            if not g.identity:
                raise ApiError(401, "AUTH_REQUIRED", "请先登录。")
            if role and g.identity["role"] != role:
                raise ApiError(403, "FORBIDDEN", "当前账号没有此操作权限。")
            return function(*args, **kwargs)

        return guarded

    return decorate


def authenticate(username, password):
    user = get_db().execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    valid = check_password_hash(user["password_hash"] if user else DUMMY_HASH, password)
    if not user or not valid or not user["enabled"]:
        raise ApiError(401, "INVALID_CREDENTIALS", "账号或密码错误。")
    return {key: user[key] for key in ("id", "username", "display_name", "role")}
