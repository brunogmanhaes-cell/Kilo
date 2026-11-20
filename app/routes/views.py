from urllib.parse import urlparse

from flask import Blueprint, current_app, jsonify, redirect, render_template, request, url_for
from flask_login import current_user, login_required, login_user, logout_user

from app.auth import AdminUser, verify_credentials

views_bp = Blueprint("views", __name__)


def _is_safe_redirect(target: str | None) -> bool:
    if not target:
        return False
    parsed = urlparse(target)
    return not parsed.scheme and not parsed.netloc and target.startswith("/") and not target.startswith("//")


@views_bp.get("/")
@login_required
def index():
    return render_template("index.html", admin_user=current_user.id)


@views_bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("views.index"))

    error: str | None = None
    next_url = request.args.get("next") or request.form.get("next")

    if request.method == "POST":
        username = request.form.get("username", "")
        password = request.form.get("password", "")

        if not (current_app.config.get("ADMIN_PASSWORD_HASH") or "").strip():
            error = "ADMIN_PASSWORD_HASH não configurado no ambiente."
            return render_template("login.html", error=error, next_url=next_url), 500

        if verify_credentials(username, password):
            login_user(AdminUser(username.strip()), remember=True)
            if _is_safe_redirect(next_url):
                return redirect(next_url)  # type: ignore[arg-type]
            return redirect(url_for("views.index"))

        error = "Usuário ou senha inválidos."
        return render_template("login.html", error=error, next_url=next_url), 401

    return render_template("login.html", error=error, next_url=next_url)


@views_bp.post("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("views.login"))


@views_bp.get("/health")
def health():
    return jsonify({"status": "ok"}), 200
