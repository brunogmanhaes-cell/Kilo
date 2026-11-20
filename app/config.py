import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()


def _parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    """Configurações da aplicação carregadas a partir de variáveis de ambiente."""

    SECRET_KEY: str = os.getenv("SECRET_KEY", "dev-insecure-secret-change-in-production")

    # Sessão e cookies
    SESSION_COOKIE_HTTPONLY: bool = True
    SESSION_COOKIE_SAMESITE: str = "Lax"
    SESSION_COOKIE_SECURE: bool = _parse_bool(os.getenv("SESSION_COOKIE_SECURE"), default=False)
    REMEMBER_COOKIE_HTTPONLY: bool = True
    REMEMBER_COOKIE_SAMESITE: str = "Lax"
    REMEMBER_COOKIE_SECURE: bool = SESSION_COOKIE_SECURE
    PERMANENT_SESSION_LIFETIME: timedelta = timedelta(days=30)

    # Limite de upload (padrão 16 MB para prints 4K antes da compressão WebP)
    MAX_CONTENT_LENGTH: int = int(os.getenv("MAX_CONTENT_LENGTH", str(16 * 1024 * 1024)))

    # Autenticação privada de usuário único
    ADMIN_USER: str = os.getenv("ADMIN_USER", "admin")
    ADMIN_PASSWORD_HASH: str = os.getenv("ADMIN_PASSWORD_HASH", "")

    # Oracle Database (Thin Mode)
    ORACLE_USER: str = os.getenv("ORACLE_USER", "")
    ORACLE_PASSWORD: str = os.getenv("ORACLE_PASSWORD", "")
    ORACLE_DSN: str = os.getenv("ORACLE_DSN", "")
    ORACLE_CONFIG_DIR: str = os.getenv("ORACLE_CONFIG_DIR", "")
    ORACLE_WALLET_LOCATION: str = os.getenv("ORACLE_WALLET_LOCATION", "")
    ORACLE_WALLET_PASSWORD: str = os.getenv("ORACLE_WALLET_PASSWORD", "")
    ORACLE_POOL_MIN: int = int(os.getenv("ORACLE_POOL_MIN", "1"))
    ORACLE_POOL_MAX: int = int(os.getenv("ORACLE_POOL_MAX", "4"))
