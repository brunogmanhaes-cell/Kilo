from flask import Blueprint, jsonify
from flask_login import login_required

from app.auth import admin_required, ensure_admin_user
from app.compression import build_note_metrics, calculate_saved_percent, decompress_text
from app.db import format_iso, get_connection, read_blob

admin_api_bp = Blueprint("admin_api", __name__, url_prefix="/api/admin")


@admin_api_bp.get("/users")
@login_required
@admin_required
def list_users():
    """Lista todos os usuários cadastrados com contagem de notas, imagens e métricas."""
    ensure_admin_user()

    with get_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                WITH note_stats AS (
                    SELECT
                        n.USER_ID,
                        COUNT(n.ID) AS NOTE_COUNT,
                        COALESCE(SUM(n.RAW_TEXT_BYTES), 0) AS RAW_TEXT_BYTES,
                        COALESCE(SUM(n.COMP_TEXT_BYTES), 0) AS COMP_TEXT_BYTES,
                        MAX(n.UPDATED_AT) AS LAST_ACTIVITY
                    FROM NOTES n
                    GROUP BY n.USER_ID
                ),
                img_stats AS (
                    SELECT
                        n.USER_ID,
                        COUNT(i.ID) AS IMG_COUNT,
                        COALESCE(SUM(i.RAW_IMAGE_BYTES), 0) AS RAW_IMG_BYTES,
                        COALESCE(SUM(i.COMP_IMAGE_BYTES), 0) AS COMP_IMG_BYTES
                    FROM NOTES n
                    JOIN NOTE_IMAGES i ON i.NOTE_ID = n.ID
                    GROUP BY n.USER_ID
                )
                SELECT
                    u.ID,
                    u.USERNAME,
                    u.EMAIL,
                    u.IS_ADMIN,
                    u.CREATED_AT,
                    COALESCE(ns.NOTE_COUNT, 0),
                    COALESCE(ist.IMG_COUNT, 0),
                    COALESCE(ns.RAW_TEXT_BYTES, 0) + COALESCE(ist.RAW_IMG_BYTES, 0),
                    COALESCE(ns.COMP_TEXT_BYTES, 0) + COALESCE(ist.COMP_IMG_BYTES, 0),
                    ns.LAST_ACTIVITY
                FROM NOTE_USERS u
                LEFT JOIN note_stats ns ON ns.USER_ID = u.ID
                LEFT JOIN img_stats ist ON ist.USER_ID = u.ID
                ORDER BY u.IS_ADMIN DESC, COALESCE(ns.LAST_ACTIVITY, u.CREATED_AT) DESC, u.ID ASC
                """
            )
            rows = cursor.fetchall()

    users = []
    for row in rows:
        raw_total = int(row[7] or 0)
        comp_total = int(row[8] or 0)
        users.append(
            {
                "id": int(row[0]),
                "username": row[1],
                "email": row[2],
                "is_admin": bool(row[3]),
                "created_at": format_iso(row[4]),
                "note_count": int(row[5] or 0),
                "image_count": int(row[6] or 0),
                "raw_bytes": raw_total,
                "compressed_bytes": comp_total,
                "saved_percent": calculate_saved_percent(raw_total, comp_total),
                "last_activity": format_iso(row[9] or row[4]),
            }
        )
    return jsonify(users), 200


@admin_api_bp.get("/users/<int:user_id>/notes")
@login_required
@admin_required
def list_user_notes(user_id: int):
    """Lista todas as notas pertencentes a um usuário específico para inspeção do admin."""
    with get_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT ID, USERNAME, EMAIL, IS_ADMIN, CREATED_AT
                FROM NOTE_USERS
                WHERE ID = :user_id
                """,
                {"user_id": user_id},
            )
            user_row = cursor.fetchone()
            if not user_row:
                return jsonify({"error": "Usuário não encontrado."}), 404

            cursor.execute(
                """
                SELECT
                    n.ID,
                    n.TITLE,
                    n.RAW_TEXT_BYTES,
                    n.COMP_TEXT_BYTES,
                    n.UPDATED_AT,
                    COALESCE(SUM(i.RAW_IMAGE_BYTES), 0) AS RAW_IMG_BYTES,
                    COALESCE(SUM(i.COMP_IMAGE_BYTES), 0) AS COMP_IMG_BYTES,
                    COUNT(i.ID) AS IMG_COUNT
                FROM NOTES n
                LEFT JOIN NOTE_IMAGES i ON i.NOTE_ID = n.ID
                WHERE n.USER_ID = :user_id
                GROUP BY
                    n.ID,
                    n.TITLE,
                    n.RAW_TEXT_BYTES,
                    n.COMP_TEXT_BYTES,
                    n.UPDATED_AT
                ORDER BY n.UPDATED_AT DESC
                """,
                {"user_id": user_id},
            )
            note_rows = cursor.fetchall()

    notes = []
    for row in note_rows:
        raw_total = int(row[2] or 0) + int(row[5] or 0)
        comp_total = int(row[3] or 0) + int(row[6] or 0)
        notes.append(
            {
                "id": int(row[0]),
                "title": row[1],
                "updated_at": format_iso(row[4]),
                "metrics": {
                    "raw_bytes": raw_total,
                    "compressed_bytes": comp_total,
                    "saved_percent": calculate_saved_percent(raw_total, comp_total),
                    "image_count": int(row[7] or 0),
                },
            }
        )

    return (
        jsonify(
            {
                "user": {
                    "id": int(user_row[0]),
                    "username": user_row[1],
                    "email": user_row[2],
                    "is_admin": bool(user_row[3]),
                    "created_at": format_iso(user_row[4]),
                },
                "notes": notes,
            }
        ),
        200,
    )


@admin_api_bp.get("/notes/<int:note_id>")
@login_required
@admin_required
def get_admin_note(note_id: int):
    """Abre qualquer nota descomprimida para visualização do administrador."""
    with get_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    n.ID,
                    n.TITLE,
                    n.CONTENT_ZLIB,
                    n.RAW_TEXT_BYTES,
                    n.COMP_TEXT_BYTES,
                    n.CREATED_AT,
                    n.UPDATED_AT,
                    u.ID,
                    u.USERNAME,
                    u.EMAIL
                FROM NOTES n
                JOIN NOTE_USERS u ON u.ID = n.USER_ID
                WHERE n.ID = :note_id
                """,
                {"note_id": note_id},
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({"error": "Nota não encontrada."}), 404

            cursor.execute(
                """
                SELECT
                    COALESCE(SUM(RAW_IMAGE_BYTES), 0),
                    COALESCE(SUM(COMP_IMAGE_BYTES), 0),
                    COUNT(ID)
                FROM NOTE_IMAGES
                WHERE NOTE_ID = :note_id
                """,
                {"note_id": note_id},
            )
            img_row = cursor.fetchone() or (0, 0, 0)

    content = decompress_text(read_blob(row[2]))

    return (
        jsonify(
            {
                "id": int(row[0]),
                "title": row[1],
                "content": content,
                "created_at": format_iso(row[5]),
                "updated_at": format_iso(row[6]),
                "owner": {
                    "id": int(row[7]),
                    "username": row[8],
                    "email": row[9],
                },
                "metrics": build_note_metrics(
                    raw_text_bytes=int(row[3] or 0),
                    compressed_text_bytes=int(row[4] or 0),
                    raw_image_bytes=int(img_row[0] or 0),
                    compressed_image_bytes=int(img_row[1] or 0),
                    image_count=int(img_row[2] or 0),
                ),
            }
        ),
        200,
    )
