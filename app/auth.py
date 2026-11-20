import hmac

from flask import current_app, jsonify, redirect, request, url_for
from flask_login import LoginManager, UserMixin
from werkzeug.security import check_password_hash

login_manager = LoginManager()


class AdminUser(UserMixin):
    """Usuário único autenticado via variáveis de ambiente."""

    def __init__(self, username: str) -> None:
        self.id = username


@login_manager.user_loader
def load_user(user_id: str) -> AdminUser | None:
    admin_user = (current_app.config.get("ADMIN_USER") or "").strip()
    if not admin_user or not user_id:
        return None
    if hmac.compare_digest(user_id, admin_user):
        return AdminUser(admin_user)
    return None


@login_manager.unauthorized_handler
def unauthorized_handler():
    if request.path.startswith("/api/"):
        return jsonify({"error": "Autenticação necessária."}), 401
    return redirect(url_for("views.login", next=request.path))


def verify_credentials(username: str, password: str) -> bool:
    """Valida usuário e senha contra ADMIN_USER e ADMIN_PASSWORD_HASH."""
    admin_user = (current_app.config.get("ADMIN_USER") or "").strip()
    password_hash = (current_app.config.get("ADMIN_PASSWORD_HASH") or "").strip()

    if not admin_user or not password_hash or not username or not password:
        return False

    user_ok = hmac.compare_digest(username.strip(), admin_user)
    pass_ok = check_password_hash(password_hash, password)
    return user_ok and pass_ok
