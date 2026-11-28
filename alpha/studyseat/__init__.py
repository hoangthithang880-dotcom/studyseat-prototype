import os
import sqlite3
import time
from pathlib import Path

import click
from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from . import db
from .auth import ApiError, check_csrf, load_identity


def create_app(test_config=None):
    app = Flask(__name__)
    app.config.from_mapping(
        SECRET_KEY=os.environ.get("STUDYSEAT_SECRET_KEY"),
        DATABASE=os.environ.get(
            "STUDYSEAT_DATABASE",
            str(Path(__file__).parent.parent / "instance" / "studyseat.sqlite3"),
        ),
        SESSION_COOKIE_NAME="studyseat_alpha",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("STUDYSEAT_HTTPS") == "1",
        MAX_CONTENT_LENGTH=8192,
        DIAGNOSTICS_UI=os.environ.get("STUDYSEAT_DIAGNOSTICS_UI") == "1",
    )
    if test_config:
        app.config.update(test_config)
    if not app.config["SECRET_KEY"] or len(app.config["SECRET_KEY"]) < 32:
        raise RuntimeError(
            "Set STUDYSEAT_SECRET_KEY to a stable random secret of at least 32 characters"
        )
    Path(app.config["DATABASE"]).parent.mkdir(parents=True, exist_ok=True)
    app.teardown_appcontext(db.close_db)

    @app.cli.command("init-db")
    @click.option("--demo", is_flag=True, help="Seed public test accounts and resources")
    def init_db(demo):
        db.initialize()
        if demo:
            from .seed import seed_demo

            seed_demo()
        click.echo("Database initialized" + (" with demo data" if demo else ""))

    @app.cli.command("expire-reservations")
    @click.option("--watch", is_flag=True, help="Repeat until interrupted")
    @click.option("--interval", default=30, type=click.IntRange(1, 3600))
    def expire_reservations(watch, interval):
        from .lifecycle import sweep

        failures = 0
        while True:
            try:
                changed = sweep()
            except sqlite3.OperationalError as error:
                if not watch or not db.is_busy(error):
                    raise
                db.get_db().rollback()
                failures += 1
                delay = min(interval * (2 ** min(failures - 1, 5)), 30)
                click.echo(f"Database busy; retrying in {delay}s (attempt {failures})", err=True)
                time.sleep(delay)
                continue
            failures = 0
            click.echo(f"Reconciled {len(changed)} reservations")
            if not watch:
                break
            time.sleep(interval)

    @app.before_request
    def identity():
        if request.path.startswith("/api/") and request.path != "/api/v1/health":
            load_identity()
            if request.method == "GET" and "X-StudySeat-Session" in request.headers:
                # A stale tab must never render private GET data for the account
                # currently signed in through that browser's shared cookie.
                check_csrf("X-StudySeat-Session")

    @app.after_request
    def headers(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        )
        return response

    @app.errorhandler(ApiError)
    def api_error(error):
        return jsonify(error={"code": error.code, "message": error.message}), error.status

    @app.errorhandler(sqlite3.DatabaseError)
    def database_error(error):
        locked = db.is_busy(error)
        app.logger.error("Database operation failed: %s", type(error).__name__)
        response = jsonify(
            error={
                "code": "DATABASE_BUSY" if locked else "DATABASE_UNAVAILABLE",
                "message": "数据库忙，请稍后重试。"
                if locked
                else "数据库尚未就绪，请检查初始化及服务日志。",
            }
        )
        response.status_code = 503
        if locked:
            response.headers["Retry-After"] = "1"
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(
            error={"code": error.name.upper().replace(" ", "_"), "message": error.description}
        ), error.code

    from .api import bp

    app.register_blueprint(bp)
    return app
