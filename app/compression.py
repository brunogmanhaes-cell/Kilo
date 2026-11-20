from dataclasses import dataclass
import hashlib
import io
import re
import zlib

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_IMAGE_WIDTH = 1280
WEBP_QUALITY = 72
WEBP_METHOD = 6
ZLIB_LEVEL = 9

_IMAGE_URL_PATTERN = re.compile(r"/api/images/(\d+)")


@dataclass(frozen=True)
class CompressedImage:
    """Resultado do pipeline de redimensionamento e codificação WebP."""

    data: bytes
    width: int
    height: int
    raw_bytes: int
    compressed_bytes: int
    sha256_hash: str
    saved_percent: float


def calculate_saved_percent(raw_bytes: int, compressed_bytes: int) -> float:
    """Calcula o percentual de economia de armazenamento (0.0 a 100.0)."""
    if raw_bytes <= 0:
        return 0.0
    ratio = 1.0 - (compressed_bytes / raw_bytes)
    return round(max(0.0, ratio * 100.0), 1)


def compress_text(text: str) -> tuple[bytes, int, int]:
    """Comprime texto UTF-8 com zlib (nível 9), retornando (bytes_comprimidos, raw_bytes, comp_bytes)."""
    if not text:
        return b"", 0, 0
    raw_data = text.encode("utf-8")
    compressed_data = zlib.compress(raw_data, level=ZLIB_LEVEL)
    return compressed_data, len(raw_data), len(compressed_data)


def decompress_text(blob: bytes | None) -> str:
    """Descomprime payload zlib de CONTENT_ZLIB para string UTF-8."""
    if not blob:
        return ""
    return zlib.decompress(blob).decode("utf-8")


def _has_transparency(img: Image.Image) -> bool:
    if img.mode in {"RGBA", "LA", "PA"}:
        return True
    if img.mode == "P" and "transparency" in img.info:
        return True
    return False


def compress_image_to_webp(
    raw_data: bytes,
    max_width: int = MAX_IMAGE_WIDTH,
    quality: int = WEBP_QUALITY,
    method: int = WEBP_METHOD,
) -> CompressedImage:
    """Redimensiona para até max_width preservando proporção e converte para WebP otimizado."""
    if not raw_data:
        raise ValueError("Arquivo de imagem vazio.")

    raw_bytes = len(raw_data)

    try:
        with Image.open(io.BytesIO(raw_data)) as opened:
            img = ImageOps.exif_transpose(opened)
            target_mode = "RGBA" if _has_transparency(img) else "RGB"
            if img.mode != target_mode:
                img = img.convert(target_mode)

            width, height = img.size
            if width > max_width:
                new_height = max(1, round(height * (max_width / width)))
                img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)
                width, height = img.size

            out_buf = io.BytesIO()
            img.save(out_buf, format="WEBP", quality=quality, method=method)
            webp_data = out_buf.getvalue()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("Arquivo enviado não é uma imagem válida.") from exc

    compressed_bytes = len(webp_data)
    sha256_hash = hashlib.sha256(webp_data).hexdigest()

    return CompressedImage(
        data=webp_data,
        width=width,
        height=height,
        raw_bytes=raw_bytes,
        compressed_bytes=compressed_bytes,
        sha256_hash=sha256_hash,
        saved_percent=calculate_saved_percent(raw_bytes, compressed_bytes),
    )


def extract_referenced_image_ids(html_content: str) -> set[int]:
    """Extrai os IDs de imagens /api/images/<id> ainda referenciados no HTML da nota."""
    if not html_content:
        return set()
    return {int(match.group(1)) for match in _IMAGE_URL_PATTERN.finditer(html_content)}


def build_note_metrics(
    raw_text_bytes: int,
    compressed_text_bytes: int,
    raw_image_bytes: int,
    compressed_image_bytes: int,
    image_count: int,
) -> dict[str, int | float]:
    """Monta o dicionário padrão de métricas de economia (texto + imagens)."""
    raw_total = int(raw_text_bytes) + int(raw_image_bytes)
    compressed_total = int(compressed_text_bytes) + int(compressed_image_bytes)
    return {
        "raw_text_bytes": int(raw_text_bytes),
        "compressed_text_bytes": int(compressed_text_bytes),
        "raw_image_bytes": int(raw_image_bytes),
        "compressed_image_bytes": int(compressed_image_bytes),
        "raw_bytes": raw_total,
        "compressed_bytes": compressed_total,
        "saved_percent": calculate_saved_percent(raw_total, compressed_total),
        "image_count": int(image_count),
    }
