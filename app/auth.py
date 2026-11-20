from functools import wraps
import hmac
import re

from flask import abort, current_app, jsonify, redirect, request, url_for
from flask_login import LoginManager, UserMixin, current_user
import oracledb
from werkzeug.security import check_password_hash, generate_password_hash

from app.db import get_connection

login_manager = LoginManager()

_USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,64}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AppUser(UserMixin):
    """Representa um usuário autenticado da tabela NOTE_USERS."""

    def __init__(self, user_id: int, username: str, email: str, is_admin: bool) -> None:
        self.id = str(user_id)
        self.user_id = int(user_id)
        self.username = username
        self.email = email
        self.is_admin = bool(is_admin)


def ensure_admin_user(conn: oracledb.Connection | None = None) -> int | None:
    """Garante que o administrador definido no .env exista em NOTE_USERS com IS_ADMIN = 1."""
    admin_user = (current_app.config.get("ADMIN_USER") or "").strip()
    admin_email = (current_app.config.get("ADMIN_EMAIL") or f"{admin_user}@kilo.local").strip()
    password_hash = (current_app.config.get("ADMIN_PASSWORD_HASH") or "").strip()

    if not admin_user or not password_hash:
        return None

    def _sync(connection: oracledb.Connection) -> int:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT ID, PASSWORD_HASH, EMAIL, IS_ADMIN
                FROM NOTE_USERS
                WHERE LOWER(USERNAME) = LOWER(:username)
                """,
                {"username": admin_user},
            )
            row = cursor.fetchone()
            if row:
                admin_id = int(row[0])
                if row[1] != password_hash or row[2] != admin_email or int(row[3]) != 1:
                    cursor.execute(
                        """
                        UPDATE NOTE_USERS
                        SET PASSWORD_HASH = :password_hash,
                            EMAIL = :email,
                            IS_ADMIN = 1
                        WHERE ID = :admin_id
                        """,
                        {
                            "password_hash": password_hash,
                            "email": admin_email,
                            "admin_id": admin_id,
                        },
                    )
                return admin_id

            out_id = cursor.var(oracledb.NUMBER)
            cursor.execute(
                """
                INSERT INTO NOTE_USERS (USERNAME, EMAIL, PASSWORD_HASH, IS_ADMIN)
                VALUES (:username, :email, :password_hash, 1)
                RETURNING ID INTO :out_id
                """,
                {
                    "username": admin_user,
                    "email": admin_email,
                    "password_hash": password_hash,
                    "out_id": out_id,
                },
            )
            return int(out_id.getvalue()[0])

    if conn is not None:
        return _sync(conn)

    with get_connection(commit=True) as new_conn:
        return _sync(new_conn)


@login_manager.user_loader
def load_user(user_id: str) -> AppUser | None:
    if not user_id:
        return None

    with get_connection() as conn:
        with conn.cursor() as cursor:
            if user_id.isdigit():
                cursor.execute(
                    """
                    SELECT ID, USERNAME, EMAIL, IS_ADMIN
                    FROM NOTE_USERS
                    WHERE ID = :user_id
                    """,
                    {"user_id": int(user_id)},
                )
            else:
                admin_user = (current_app.config.get("ADMIN_USER") or "").strip()
                if not admin_user or not hmac.compare_digest(user_id, admin_user):
                    return None
                cursor.execute(
                    """
                    SELECT ID, USERNAME, EMAIL, IS_ADMIN
                    FROM NOTE_USERS
                    WHERE LOWER(USERNAME) = LOWER(:username) AND IS_ADMIN = 1
                    """,
                    {"username": admin_user},
                )
            row = cursor.fetchone()

    if not row:
        return None
    return AppUser(user_id=int(row[0]), username=row[1], email=row[2], is_admin=bool(row[3]))


@login_manager.unauthorized_handler
def unauthorized_handler():
    if request.path.startswith("/api/"):
        return jsonify({"error": "Autenticação necessária."}), 401
    return redirect(url_for("views.login", next=request.path))


def admin_required(view):
    """Restringe o acesso a usuários autenticados com perfil administrador."""

    @wraps(view)
    def wrapped(*args, **kwargs):
        if not current_user.is_authenticated:
            return unauthorized_handler()
        if not getattr(current_user, "is_admin", False):
            if request.path.startswith("/api/"):
                return jsonify({"error": "Acesso restrito ao administrador."}), 403
            abort(403)
        return view(*args, **kwargs)

    return wrapped


def authenticate_user(identifier: str, password: str) -> AppUser | None:
    """Autentica por nome de usuário ou e-mail contra NOTE_USERS (sincronizando admin do .env)."""
    ident = (identifier or "").strip()
    if not ident or not password:
        return None

    admin_user = (current_app.config.get("ADMIN_USER") or "").strip()
    admin_email = (current_app.config.get("ADMIN_EMAIL") or f"{admin_user}@kilo.local").strip()

    if ident.lower() in {admin_user.lower(), admin_email.lower()}:
        ensure_admin_user()

    with get_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT ID, USERNAME, EMAIL, PASSWORD_HASH, IS_ADMIN
                FROM NOTE_USERS
                WHERE LOWER(USERNAME) = LOWER(:ident)
                   OR LOWER(EMAIL) = LOWER(:ident)
                """,
                {"ident": ident},
            )
            row = cursor.fetchone()

    if not row:
        return None

    if not check_password_hash(row[3], password):
        return None

    return AppUser(
        user_id=int(row[0]),
        username=row[1],
        email=row[2],
        is_admin=bool(row[4]),
    )


def register_user(username: str, email: str, password: str) -> AppUser:
    """Valida e registra um novo usuário padrão em NOTE_USERS."""
    clean_user = (username or "").strip()
    clean_email = (email or "").strip().lower()

    if not _USERNAME_RE.match(clean_user):
        raise ValueError(
            "Nome de usuário deve ter entre 3 e 64 caracteres (letras, números, '.', '_' ou '-')."
        )
    if not _EMAIL_RE.match(clean_email) or len(clean_email) > 255:
        raise ValueError("Informe um endereço de e-mail válido.")
    if not password or len(password) < 6:
        raise ValueError("A senha deve ter pelo menos 6 caracteres.")

    admin_user = (current_app.config.get("ADMIN_USER") or "").strip()
    if admin_user and clean_user.lower() == admin_user.lower():
        ensure_admin_user()

    password_hash = generate_password_hash(password)

    with get_connection(commit=True) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT 1 FROM NOTE_USERS WHERE LOWER(USERNAME) = LOWER(:username)",
                {"username": clean_user},
            )
            if cursor.fetchone():
                raise ValueError("Este nome de usuário já está em uso.")

            cursor.execute(
                "SELECT 1 FROM NOTE_USERS WHERE LOWER(EMAIL) = LOWER(:email)",
                {"email": clean_email},
            )
            if cursor.fetchone():
                raise ValueError("Este e-mail já está cadastrado.")

            out_id = cursor.var(oracledb.NUMBER)
            cursor.execute(
                """
                INSERT INTO NOTE_USERS (USERNAME, EMAIL, PASSWORD_HASH, IS_ADMIN)
                VALUES (:username, :email, :password_hash, 0)
                RETURNING ID INTO :out_id
                """,
                {
                    "username": clean_user,
                    "email": clean_email,
                    "password_hash": password_hash,
                    "out_id": out_id,
                },
            )
            user_id = int(out_id.getvalue()[0])

    return AppUser(user_id=user_id, username=clean_user, email=clean_email, is_admin=False)
