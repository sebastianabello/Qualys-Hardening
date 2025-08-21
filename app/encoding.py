from __future__ import annotations
from pathlib import Path

# Firmas BOM conocidas
_BOMS = [
    (b"\xef\xbb\xbf", "utf-8-sig"),
    (b"\xff\xfe\x00\x00", "utf-32-le"),
    (b"\x00\x00\xfe\xff", "utf-32-be"),
    (b"\xff\xfe", "utf-16-le"),
    (b"\xfe\xff", "utf-16-be"),
]

def detect_encoding(path: Path, sample_size: int = 512 * 1024) -> str:
    """Detecta encoding de manera rápida y robusta, sin cargar todo el archivo."""
    with path.open("rb") as f:
        head4 = f.read(4)
        # 1) BOM
        for bom, enc in _BOMS:
            if head4.startswith(bom):
                return enc
        # 2) Heurística nulos: sugiere UTF-16/32 sin BOM
        if b"\x00" in head4:
            # Asumimos UTF-16 si hay nulos tempranos
            return "utf-16"

        f.seek(0)
        sample = f.read(sample_size)

    # 3) Intento estricto UTF-8
    try:
        sample.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        pass

    # 4) charset-normalizer
    try:
        from charset_normalizer import from_bytes
        best = from_bytes(sample).best()
        if best and best.encoding:
            return best.encoding
    except Exception:
        pass

    # 5) Fallback seguro
    return "latin-1"
