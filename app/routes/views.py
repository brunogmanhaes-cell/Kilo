from urllib.parse import urlparse

from flask import Blueprint, redirect, render_template, request, url_for
from flask_login import current_user, login_required, login_user, logout_user

from app.auth import admin_required, authenticate_user, register_user

views_bp = Blueprint("views", __name__)


def _is_safe_redirect(target: str | None) -> bool:
    if not target:
        return False
    parsed = urlparse(target)
    return not parsed.scheme and not parsed.netloc and target.startswith("/") and not target.startswith("//")


@views_bp.get("/")
@login_required
def index():
    return render_template(
        "index.html",
        username=current_user.username,
        email=current_user.email,
        is_admin=current_user.is_admin,
    )


@views_bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("views.index"))

    error: str | None = None
    next_url = request.args.get("next") or request.form.get("next")
    identifier_value = ""

    if request.method == "POST":
        identifier = request.form.get("identifier") or request.form.get("username", "")
        password = request.form.get("password", "")
        identifier_value = identifier.strip()

        user = authenticate_user(identifier_value, password)
        if user is not None:
            login_user(user, remember=True)
            if _is_safe_redirect(next_url):
                return redirect(next_url)  # type: ignore[arg-type]
            return redirect(url_for("views.index"))

        error = "Usuário/e-mail ou senha inválidos."
        return render_template(
            "login.html",
            error=error,
            next_url=next_url,
            identifier=identifier_value,
        ), 401

    return render_template(
        "login.html",
        error=error,
        next_url=next_url,
        identifier=identifier_value,
    )


@views_bp.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("views.index"))

    error: str | None = None
    username_value = ""
    email_value = ""

    if request.method == "POST":
        username_value = request.form.get("username", "").strip()
        email_value = request.form.get("email", "").strip()
        password = request.form.get("password", "")
        confirm_password = request.form.get("confirm_password", "")

        if password != confirm_password:
            error = "As senhas informadas não coincidem."
            return render_template(
                "register.html",
                error=error,
                username=username_value,
                email=email_value,
            ), 400

        try:
            user = register_user(username_value, email_value, password)
        except ValueError as exc:
            return render_template(
                "register.html",
                error=str(exc),
                username=username_value,
                email=email_value,
            ), 400

        login_user(user, remember=True)
        return redirect(url_for("views.index"))

    return render_template(
        "register.html",
        error=error,
        username=username_value,
        email=email_value,
    )


@views_bp.get("/admin")
@login_required
@admin_required
def admin_panel():
    return render_template(
        "admin.html",
        username=current_user.username,
        email=current_user.email,
    )


@views_bp.post("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("views.login"))


@views_bp.get("/health")
def health():
    return {"status": "ok"}, 200
