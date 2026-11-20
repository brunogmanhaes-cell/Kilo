from flask import Blueprint, Response, jsonify, request
from flask_login import login_required
import oracledb

from app.compression import compress_image_to_webp
from app.db import get_connection, read_blob

images_api_bp = Blueprint("images_api", __name__, url_prefix="/api")

_CACHE_CONTROL = "public, max-age=31536000, immutable"


@images_api_bp.post("/upload")
@login_required
def upload_image():
    """Intercepta imagem (Ctrl+V), converte para WebP (max 1280px, q=72, m=6) e grava em NOTE_IMAGES."""
    raw_note_id = request.form.get("note_id", "").strip()
    try:
        note_id = int(raw_note_id)
        if note_id <= 0:
            raise ValueError
    except ValueError:
        return jsonify({"error": "note_id inválido."}), 400

    image_file = request.files.get("image")
    if image_file is None or not image_file.filename:
        if image_file is None:
            return jsonify({"error": "Campo 'image' é obrigatório."}), 400

    raw_bytes = image_file.read()
    try:
        compressed = compress_image_to_webp(raw_bytes)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    with get_connection(commit=True) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT 1 FROM NOTES WHERE ID = :note_id",
                {"note_id": note_id},
            )
            if not cursor.fetchone():
                return jsonify({"error": "Nota não encontrada."}), 404

            out_id = cursor.var(oracledb.NUMBER)
            cursor.execute(
                """
                INSERT INTO NOTE_IMAGES (
                    NOTE_ID,
                    IMAGE_WEBP,
                    WIDTH,
                    HEIGHT,
                    RAW_IMAGE_BYTES,
                    COMP_IMAGE_BYTES,
                    SHA256_HASH
                )
                VALUES (
                    :note_id,
                    :image_webp,
                    :width,
                    :height,
                    :raw_bytes,
                    :comp_bytes,
                    :sha256_hash
                )
                RETURNING ID INTO :out_id
                """,
                {
                    "note_id": note_id,
                    "image_webp": compressed.data,
                    "width": compressed.width,
                    "height": compressed.height,
                    "raw_bytes": compressed.raw_bytes,
                    "comp_bytes": compressed.compressed_bytes,
                    "sha256_hash": compressed.sha256_hash,
                    "out_id": out_id,
                },
            )
            image_id = int(out_id.getvalue()[0])

            cursor.execute(
                "UPDATE NOTES SET UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = :note_id",
                {"note_id": note_id},
            )

    return (
        jsonify(
            {
                "id": image_id,
                "url": f"/api/images/{image_id}",
                "width": compressed.width,
                "height": compressed.height,
                "raw_bytes": compressed.raw_bytes,
                "compressed_bytes": compressed.compressed_bytes,
                "saved_percent": compressed.saved_percent,
            }
        ),
        201,
    )


@images_api_bp.get("/images/<int:image_id>")
@login_required
def get_image(image_id: int):
    """Entrega o BLOB WebP com Cache-Control imutável e suporte a ETag (304)."""
    if_none_match = (request.headers.get("If-None-Match") or "").strip()

    with get_connection() as conn:
        with conn.cursor() as cursor:
            if if_none_match:
                cursor.execute(
                    "SELECT COMP_IMAGE_BYTES FROM NOTE_IMAGES WHERE ID = :image_id",
                    {"image_id": image_id},
                )
                meta_row = cursor.fetchone()
                if not meta_row:
                    return jsonify({"error": "Imagem não encontrada."}), 404

                etag = f'"img-{image_id}-{int(meta_row[0])}"'
                if etag in if_none_match or if_none_match == "*":
                    return Response(
                        status=304,
                        headers={
                            "Cache-Control": _CACHE_CONTROL,
                            "ETag": etag,
                        },
                    )

            cursor.execute(
                """
                SELECT IMAGE_WEBP, COMP_IMAGE_BYTES
                FROM NOTE_IMAGES
                WHERE ID = :image_id
                """,
                {"image_id": image_id},
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({"error": "Imagem não encontrada."}), 404

    img_bytes = read_blob(row[0])
    etag = f'"img-{image_id}-{int(row[1])}"'

    return Response(
        img_bytes,
        status=200,
        mimetype="image/webp",
        headers={
            "Cache-Control": _CACHE_CONTROL,
            "ETag": etag,
            "X-Content-Type-Options": "nosniff",
        },
    )
