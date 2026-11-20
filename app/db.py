import atexit
from contextlib import contextmanager
from datetime import datetime, timezone
import threading
from typing import Any, Iterator

from flask import Flask
import oracledb

# Retorna BLOBs diretamente como bytes Python nativos sem round-trips extras de LOB locators.
oracledb.defaults.fetch_lobs = False

_pool: oracledb.ConnectionPool | None = None
_pool_lock = threading.Lock()
_db_config: dict[str, Any] = {}
_atexit_registered = False


def init_db(app: Flask) -> None:
    """Registra parâmetros do Oracle sem abrir conexão imediata (lazy + seguro para Gunicorn)."""
    global _db_config, _atexit_registered

    _db_config = {
        "user": app.config.get("ORACLE_USER", ""),
        "password": app.config.get("ORACLE_PASSWORD", ""),
        "dsn": app.config.get("ORACLE_DSN", ""),
        "config_dir": app.config.get("ORACLE_CONFIG_DIR", ""),
        "wallet_location": app.config.get("ORACLE_WALLET_LOCATION", ""),
        "wallet_password": app.config.get("ORACLE_WALLET_PASSWORD", ""),
        "min": int(app.config.get("ORACLE_POOL_MIN", 1)),
        "max": int(app.config.get("ORACLE_POOL_MAX", 4)),
    }

    if not _atexit_registered:
        atexit.register(close_pool)
        _atexit_registered = True


def get_pool() -> oracledb.ConnectionPool:
    """Inicializa sob demanda e retorna o ConnectionPool em Thin Mode."""
    global _pool

    if _pool is not None:
        return _pool

    with _pool_lock:
        if _pool is not None:
            return _pool

        user = (_db_config.get("user") or "").strip()
        password = _db_config.get("password") or ""
        dsn = (_db_config.get("dsn") or "").strip()

        if not user or not password or not dsn:
            raise RuntimeError(
                "Credenciais Oracle incompletas. Defina ORACLE_USER, ORACLE_PASSWORD e ORACLE_DSN."
            )

        pool_min = max(1, int(_db_config.get("min", 1)))
        pool_max = max(pool_min, int(_db_config.get("max", 4)))

        pool_kwargs: dict[str, Any] = {
            "user": user,
            "password": password,
            "dsn": dsn,
            "min": pool_min,
            "max": pool_max,
            "increment": 1,
            "ping_interval": 60,
            "timeout": 120,
            "getmode": oracledb.POOL_GETMODE_WAIT,
        }

        config_dir = (_db_config.get("config_dir") or "").strip()
        wallet_location = (_db_config.get("wallet_location") or "").strip()
        wallet_password = _db_config.get("wallet_password") or ""

        if config_dir:
            pool_kwargs["config_dir"] = config_dir
        if wallet_location:
            pool_kwargs["wallet_location"] = wallet_location
        if wallet_password:
            pool_kwargs["wallet_password"] = wallet_password

        # Thin Mode exclusivamente (nenhuma chamada a init_oracle_client)
        _pool = oracledb.create_pool(**pool_kwargs)
        return _pool


@contextmanager
def get_connection(commit: bool = False) -> Iterator[oracledb.Connection]:
    """Context manager que adquire uma conexão do pool e garante commit/rollback atômico."""
    pool = get_pool()
    with pool.acquire() as conn:
        try:
            yield conn
            if commit:
                conn.commit()
        except Exception:
            conn.rollback()
            raise


def close_pool() -> None:
    """Fecha o pool de conexões no encerramento do processo."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            try:
                _pool.close(force=True)
            except Exception:
                pass
            finally:
                _pool = None


def read_blob(value: Any) -> bytes:
    """Converte um retorno BLOB (bytes, memoryview ou LOB fallback) em bytes."""
    if value is None:
        return b""
    if isinstance(value, bytes):
        return value
    if isinstance(value, (bytearray, memoryview)):
        return bytes(value)
    if hasattr(value, "read"):
        data = value.read()
        return data if isinstance(data, bytes) else bytes(data)
    return bytes(value)


def format_iso(dt: datetime | None) -> str:
    """Formata um TIMESTAMP/datetime Oracle como ISO-8601 UTC com sufixo Z."""
    if dt is None:
        return ""
    if dt.tzinfo is not None:
        dt_utc = dt.astimezone(timezone.utc)
    else:
        dt_utc = dt.replace(tzinfo=timezone.utc)
    return dt_utc.isoformat().replace("+00:00", "Z")
