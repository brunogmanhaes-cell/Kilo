from dataclasses import dataclass
import hashlib
import html
from html.parser import HTMLParser
import io
import re
import zlib

from PIL import Image, ImageOps, UnidentifiedImageError

WEBP_METHOD = 4
ZLIB_LEVEL = 9

_IMAGE_URL_PATTERN = re.compile(r"/api/images/(\d+)")
_SAFE_IMAGE_SRC_RE = re.compile(r"^/api/images/\d+$")

_ALLOWED_TAGS = {
    "p",
    "div",
    "br",
    "span",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "s",
    "strike",
    "code",
    "pre",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "blockquote",
    "img",
}
_VOID_TAGS = {"br", "img"}
_STRIP_CONTENT_TAGS = {"script", "style", "iframe", "object", "embed", "svg", "math"}

_COLOR_VALUE_RE = re.compile(
    r"^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})|"
    r"rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|"
    r"rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\)|"
    r"transparent|inherit)$"
)
_FONT_SIZE_RE = re.compile(r"^(\d{1,2})px$", re.IGNORECASE)
_FONT_WEIGHT_RE = re.compile(r"^(?:bold|normal|[1-9]00)$", re.IGNORECASE)
_FONT_STYLE_RE = re.compile(r"^(?:italic|normal)$", re.IGNORECASE)
_TEXT_DECOR_RE = re.compile(r"^(?:underline|line-through|none)$", re.IGNORECASE)


@dataclass(frozen=True)
class CompressedImage:
    """Resultado do pipeline de compressão 100% sem perdas (lossless)."""

    data: bytes
    width: int
    height: int
    raw_bytes: int
    compressed_bytes: int
    mime_type: str
    is_zlib: bool
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


def decompress_image_payload(blob: bytes, is_zlib: bool) -> bytes:
    """Descomprime bytes de imagem caso armazenados com camada adicional zlib."""
    if not blob:
        return b""
    if is_zlib:
        return zlib.decompress(blob)
    return blob


def _has_transparency(img: Image.Image) -> bool:
    if img.mode in {"RGBA", "LA", "PA"}:
        return True
    if img.mode == "P" and "transparency" in img.info:
        return True
    return False


def compress_image_lossless(raw_data: bytes, method: int = WEBP_METHOD) -> CompressedImage:
    """Comprime a imagem de forma 100% lossless preservando resolução e fidelidade originais."""
    if not raw_data:
        raise ValueError("Arquivo de imagem vazio.")

    raw_bytes = len(raw_data)

    try:
        with Image.open(io.BytesIO(raw_data)) as opened:
            source_format = (opened.format or "").upper()
            exif = opened.getexif()
            orientation = exif.get(274, 1) if exif else 1

            img = ImageOps.exif_transpose(opened) if orientation != 1 else opened
            target_mode = "RGBA" if _has_transparency(img) else "RGB"
            if img.mode != target_mode:
                img = img.convert(target_mode)

            width, height = img.size

            webp_buf = io.BytesIO()
            img.save(webp_buf, format="WEBP", lossless=True, quality=100, method=method)
            webp_data = webp_buf.getvalue()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("Arquivo enviado não é uma imagem válida.") from exc

    candidates: list[tuple[bytes, str]] = [(webp_data, "image/webp")]
    if orientation == 1:
        if source_format == "JPEG":
            candidates.append((raw_data, "image/jpeg"))
        elif source_format == "WEBP":
            candidates.append((raw_data, "image/webp"))

    best_data, best_mime = min(candidates, key=lambda item: len(item[0]))

    z_data = zlib.compress(best_data, level=ZLIB_LEVEL)
    if len(z_data) < len(best_data):
        stored_data = z_data
        is_zlib = True
    else:
        stored_data = best_data
        is_zlib = False

    compressed_bytes = len(stored_data)
    sha256_hash = hashlib.sha256(stored_data).hexdigest()

    return CompressedImage(
        data=stored_data,
        width=width,
        height=height,
        raw_bytes=raw_bytes,
        compressed_bytes=compressed_bytes,
        mime_type=best_mime,
        is_zlib=is_zlib,
        sha256_hash=sha256_hash,
        saved_percent=calculate_saved_percent(raw_bytes, compressed_bytes),
    )


# Alias mantido para compatibilidade com importações existentes
compress_image_to_webp = compress_image_lossless


def _sanitize_style(raw_style: str) -> str:
    safe_parts: list[str] = []
    for decl in raw_style.split(";"):
        if ":" not in decl:
            continue
        prop, val = decl.split(":", 1)
        prop_name = prop.strip().lower()
        prop_val = val.strip()
        if not prop_val or "url(" in prop_val.lower() or "expression(" in prop_val.lower():
            continue

        if prop_name == "font-size":
            match = _FONT_SIZE_RE.match(prop_val)
            if match:
                px = max(10, min(48, int(match.group(1))))
                safe_parts.append(f"font-size: {px}px")
        elif prop_name in {"color", "background-color"}:
            if _COLOR_VALUE_RE.match(prop_val):
                safe_parts.append(f"{prop_name}: {prop_val}")
        elif prop_name == "font-weight" and _FONT_WEIGHT_RE.match(prop_val):
            safe_parts.append(f"font-weight: {prop_val.lower()}")
        elif prop_name == "font-style" and _FONT_STYLE_RE.match(prop_val):
            safe_parts.append(f"font-style: {prop_val.lower()}")
        elif prop_name in {"text-decoration", "text-decoration-line"} and _TEXT_DECOR_RE.match(prop_val):
            safe_parts.append(f"{prop_name}: {prop_val.lower()}")

    return "; ".join(safe_parts)


class _NoteHTMLSanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0
        self._open_stack: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag_l = tag.lower()
        if tag_l in _STRIP_CONTENT_TAGS:
            self._skip_depth += 1
            return
        if self._skip_depth > 0 or tag_l not in _ALLOWED_TAGS:
            return

        attr_map = {k.lower(): (v or "") for k, v in attrs}

        if tag_l == "img":
            src = attr_map.get("src", "").strip()
            if not _SAFE_IMAGE_SRC_RE.match(src):
                return
            img_attrs = [f'src="{html.escape(src, quote=True)}"']
            for dim in ("width", "height"):
                val = attr_map.get(dim, "").strip()
                if val.isdigit():
                    img_attrs.append(f'{dim}="{val}"')
            alt = attr_map.get("alt", "Imagem anexada").strip()[:200]
            img_attrs.append(f'alt="{html.escape(alt, quote=True)}"')
            img_attrs.append('loading="lazy"')
            self.parts.append(f"<img {' '.join(img_attrs)}>")
            return

        if tag_l == "br":
            self.parts.append("<br>")
            return

        clean_attrs: list[str] = []
        raw_style = attr_map.get("style", "")
        if raw_style:
            safe_style = _sanitize_style(raw_style)
            if safe_style:
                clean_attrs.append(f'style="{html.escape(safe_style, quote=True)}"')

        attr_str = f" {' '.join(clean_attrs)}" if clean_attrs else ""
        self.parts.append(f"<{tag_l}{attr_str}>")
        if tag_l not in _VOID_TAGS:
            self._open_stack.append(tag_l)

    def handle_endtag(self, tag: str) -> None:
        tag_l = tag.lower()
        if tag_l in _STRIP_CONTENT_TAGS:
            if self._skip_depth > 0:
                self._skip_depth -= 1
            return
        if self._skip_depth > 0 or tag_l not in _ALLOWED_TAGS or tag_l in _VOID_TAGS:
            return

        if tag_l in self._open_stack:
            while self._open_stack:
                top = self._open_stack.pop()
                self.parts.append(f"</{top}>")
                if top == tag_l:
                    break

    def handle_data(self, data: str) -> None:
        if self._skip_depth > 0:
            return
        self.parts.append(html.escape(data, quote=False))

    def get_html(self) -> str:
        while self._open_stack:
            self.parts.append(f"</{self._open_stack.pop()}>")
        return "".join(self.parts)


def sanitize_note_html(html_content: str) -> str:
    """Sanitiza HTML do editor preservando estilos seguros e imagens internas."""
    if not html_content:
        return ""
    parser = _NoteHTMLSanitizer()
    parser.feed(html_content)
    parser.close()
    return parser.get_html()


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
