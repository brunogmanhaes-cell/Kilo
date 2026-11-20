from flask import Blueprint, jsonify, request
from flask_login import login_required
import oracledb

from app.compression import (
    build_note_metrics,
    calculate_saved_percent,
    compress_text,
    decompress_text,
    extract_referenced_image_ids,
)
from app.db import format_iso, get_connection, read_blob

notes_api_bp = Blueprint("notes_api", __name__, url_prefix="/api/notes")


def _normalize_title(raw_title: object) -> str:
    if not isinstance(raw_title, str):
        return "Sem título"
    cleaned = raw_title.strip()[:255]
    return cleaned or "Sem título"


def _fetch_image_aggregates(cursor: oracledb.Cursor, note_id: int) -> tuple[int, int, int]:
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
    row = cursor.fetchone()
    if not row:
        return 0, 0, 0
    return int(row[0] or 0), int(row[1] or 0), int(row[2] or 0)


@notes_api_bp.get("")
@login_required
def list_notes():
    """Lista todas as notas sem trafegar CONTENT_ZLIB, com resumo de economia."""
    with get_connection() as conn:
        with conn.cursor() as cursor:
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
                GROUP BY
                    n.ID,
                    n.TITLE,
                    n.RAW_TEXT_BYTES,
                    n.COMP_TEXT_BYTES,
                    n.UPDATED_AT
                ORDER BY n.UPDATED_AT DESC
                """
            )
            rows = cursor.fetchall()

    notes = []
    for row in rows:
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
    return jsonify(notes), 200


@notes_api_bp.post("")
@login_required
def create_note():
    """Cria uma nova nota comprimida com zlib."""
    payload = request.get_json(silent=True) or {}
    title = _normalize_title(payload.get("title"))
    content = payload.get("content")
    if not isinstance(content, str):
        content = ""

    comp_blob, raw_text_bytes, comp_text_bytes = compress_text(content)

    with get_connection(commit=True) as conn:
        with conn.cursor() as cursor:
            out_id = cursor.var(oracledb.NUMBER)
            cursor.execute(
                """
                INSERT INTO NOTES (TITLE, CONTENT_ZLIB, RAW_TEXT_BYTES, COMP_TEXT_BYTES)
                VALUES (:title, :content_zlib, :raw_bytes, :comp_bytes)
                RETURNING ID INTO :out_id
                """,
                {
                    "title": title,
                    "content_zlib": comp_blob if comp_blob else None,
                    "raw_bytes": raw_text_bytes,
                    "comp_bytes": comp_text_bytes,
                    "out_id": out_id,
                },
            )
            note_id = int(out_id.getvalue()[0])

            cursor.execute(
                """
                SELECT CREATED_AT, UPDATED_AT
                FROM NOTES
                WHERE ID = :note_id
                """,
                {"note_id": note_id},
            )
            timestamps = cursor.fetchone()

    created_iso = format_iso(timestamps[0]) if timestamps else ""
    updated_iso = format_iso(timestamps[1]) if timestamps else ""

    return (
        jsonify(
            {
                "id": note_id,
                "title": title,
                "content": content,
                "created_at": created_iso,
                "updated_at": updated_iso,
                "metrics": build_note_metrics(
                    raw_text_bytes=raw_text_bytes,
                    compressed_text_bytes=comp_text_bytes,
                    raw_image_bytes=0,
                    compressed_image_bytes=0,
                    image_count=0,
                ),
            }
        ),
        201,
    )


@notes_api_bp.get("/<int:note_id>")
@login_required
def get_note(note_id: int):
    """Carrega nota específica e descomprime CONTENT_ZLIB em memória."""
    with get_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    ID,
                    TITLE,
                    CONTENT_ZLIB,
                    RAW_TEXT_BYTES,
                    COMP_TEXT_BYTES,
                    CREATED_AT,
                    UPDATED_AT
                FROM NOTES
                WHERE ID = :note_id
                """,
                {"note_id": note_id},
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({"error": "Nota não encontrada."}), 404

            raw_img_bytes, comp_img_bytes, img_count = _fetch_image_aggregates(cursor, note_id)

    content = decompress_text(read_blob(row[2]))
    raw_text_bytes = int(row[3] or 0)
    comp_text_bytes = int(row[4] or 0)

    return (
        jsonify(
            {
                "id": int(row[0]),
                "title": row[1],
                "content": content,
                "created_at": format_iso(row[5]),
                "updated_at": format_iso(row[6]),
                "metrics": build_note_metrics(
                    raw_text_bytes=raw_text_bytes,
                    compressed_text_bytes=comp_text_bytes,
                    raw_image_bytes=raw_img_bytes,
                    compressed_image_bytes=comp_img_bytes,
                    image_count=img_count,
                ),
            }
        ),
        200,
    )


@notes_api_bp.put("/<int:note_id>")
@login_required
def update_note(note_id: int):
    """Atualiza nota comprimida e limpa imagens órfãs removidas do HTML."""
    payload = request.get_json(silent=True) or {}
    title = _normalize_title(payload.get("title"))
    content = payload.get("content")
    if not isinstance(content, str):
        content = ""

    comp_blob, raw_text_bytes, comp_text_bytes = compress_text(content)
    referenced_ids = extract_referenced_image_ids(content)

    with get_connection(commit=True) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                UPDATE NOTES
                SET
                    TITLE = :title,
                    CONTENT_ZLIB = :content_zlib,
                    RAW_TEXT_BYTES = :raw_bytes,
                    COMP_TEXT_BYTES = :comp_bytes,
                    UPDATED_AT = CURRENT_TIMESTAMP
                WHERE ID = :note_id
                """,
                {
                    "title": title,
                    "content_zlib": comp_blob if comp_blob else None,
                    "raw_bytes": raw_text_bytes,
                    "comp_bytes": comp_text_bytes,
                    "note_id": note_id,
                },
            )
            if cursor.rowcount == 0:
                return jsonify({"error": "Nota não encontrada."}), 404

            # Garbage collection de imagens removidas do corpo da nota
            if not referenced_ids:
                cursor.execute(
                    "DELETE FROM NOTE_IMAGES WHERE NOTE_ID = :note_id",
                    {"note_id": note_id},
                )
            else:
                cursor.execute(
                    "SELECT ID FROM NOTE_IMAGES WHERE NOTE_ID = :note_id",
                    {"note_id": note_id},
                )
                orphan_rows = [
                    {"note_id": note_id, "img_id": int(r[0])}
                    for r in cursor.fetchall()
                    if int(r[0]) not in referenced_ids
                ]
                if orphan_rows:
                    cursor.executemany(
                        "DELETE FROM NOTE_IMAGES WHERE NOTE_ID = :note_id AND ID = :img_id",
                        orphan_rows,
                    )

            cursor.execute(
                "SELECT UPDATED_AT FROM NOTES WHERE ID = :note_id",
                {"note_id": note_id},
            )
            updated_row = cursor.fetchone()
            raw_img_bytes, comp_img_bytes, img_count = _fetch_image_aggregates(cursor, note_id)

    return (
        jsonify(
            {
                "id": note_id,
                "title": title,
                "updated_at": format_iso(updated_row[0]) if updated_row else "",
                "metrics": build_note_metrics(
                    raw_text_bytes=raw_text_bytes,
                    compressed_text_bytes=comp_text_bytes,
                    raw_image_bytes=raw_img_bytes,
                    compressed_image_bytes=comp_img_bytes,
                    image_count=img_count,
                ),
            }
        ),
        200,
    )


@notes_api_bp.delete("/<int:note_id>")
@login_required
def delete_note(note_id: int):
    """Remove a nota; imagens associadas são limpas via ON DELETE CASCADE."""
    with get_connection(commit=True) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                "DELETE FROM NOTES WHERE ID = :note_id",
                {"note_id": note_id},
            )
            if cursor.rowcount == 0:
                return jsonify({"error": "Nota não encontrada."}), 404

    return "", 204
