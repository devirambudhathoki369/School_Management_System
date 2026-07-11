"""
Validated file intake — every upload in the platform passes through here.

The legacy system trusted extensions and stored whatever arrived, wherever
it arrived. Here the rules are explicit:

- The CONTENT decides the type (magic bytes / Pillow verification), never
  the filename or the client's Content-Type header.
- Each upload kind has an allowlist and a size cap; anything else is a 400.
- Stored names are fresh UUIDs with an extension derived from the sniffed
  type, under a per-school prefix — user-controlled filenames never touch
  the filesystem (no traversal, no collisions, no weird unicode).
- The original filename survives only as display metadata on the row.
"""

import uuid

from PIL import Image, UnidentifiedImageError
from rest_framework.exceptions import ValidationError

MB = 1024 * 1024

# Image formats a school actually uses; SVG is deliberately absent (XSS
# vector when ever rendered inline).
IMAGE_FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp", "GIF": "gif"}

DOCUMENT_MAGIC: tuple[tuple[bytes, str], ...] = (
    (b"%PDF-", "pdf"),
    (b"PK\x03\x04", "zip"),      # docx/xlsx/pptx/odt and plain zip
    (b"\xd0\xcf\x11\xe0", "doc"),  # legacy OLE office (doc/xls/ppt)
)

KINDS = {
    # photos: person headshots — images only, kept small
    "photo": {"max_bytes": 5 * MB},
    # images: notices, news, branding artwork
    "image": {"max_bytes": 8 * MB},
    # documents: homework and submissions — images or common documents
    "document": {"max_bytes": 25 * MB},
}


def _sniff_image(upload) -> str | None:
    """The sniffed image extension, or None when it isn't a real image."""
    try:
        upload.seek(0)
        image = Image.open(upload)
        image.verify()  # walks the file; corrupt/forged files raise
        return IMAGE_FORMATS.get(image.format or "")
    except (UnidentifiedImageError, OSError):
        return None
    finally:
        upload.seek(0)


def _sniff_document(upload) -> str | None:
    head = upload.read(8)
    upload.seek(0)
    for magic, ext in DOCUMENT_MAGIC:
        if head.startswith(magic):
            return ext
    # plain text (assignment sheets exported as .txt/.csv): must decode AND
    # actually look like text — UTF-8 happily accepts low control bytes, so
    # decoding alone would wave arbitrary binaries through.
    sample = upload.read(4096)
    upload.seek(0)
    if b"\x00" in sample:
        return None
    try:
        sample.decode("utf-8")
    except UnicodeDecodeError:
        return None
    printable = sum(1 for b in sample if b in (9, 10, 13) or 32 <= b < 127 or b >= 128)
    return "txt" if printable / len(sample) > 0.95 else None


def validate(upload, kind: str) -> str:
    """Check size + content for one upload; returns the extension the file
    EARNED by its content. Raises ValidationError otherwise."""
    rules = KINDS[kind]
    if upload.size == 0:
        raise ValidationError({"file": "The file is empty."})
    if upload.size > rules["max_bytes"]:
        raise ValidationError(
            {"file": f"Too large — the limit is {rules['max_bytes'] // MB} MB."}
        )
    ext = _sniff_image(upload)
    if ext is None and kind == "document":
        ext = _sniff_document(upload)
    if ext is None:
        allowed = "an image" if kind in ("photo", "image") else "an image, PDF or document"
        raise ValidationError({"file": f"Unsupported file type — send {allowed}."})
    return ext


def stored_name(school_id, category: str, ext: str) -> str:
    """Collision-free, traversal-free storage path under the school."""
    return f"schools/{school_id}/{category}/{uuid.uuid4().hex}.{ext}"
