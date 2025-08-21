import hashlib
import shutil
from pathlib import Path
from .config import UPLOADS_DIR, OUTPUTS_DIR

def sha256_of_file(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            b = f.read(chunk_size)
            if not b: break
            h.update(b)
    return h.hexdigest()

def finalize_upload(tmp_path: Path, orig_name: str) -> tuple[str, Path, int]:
    digest = sha256_of_file(tmp_path)[:16]
    target = UPLOADS_DIR / f"{digest}_{orig_name}"
    # mover (O(1) si misma partición)
    shutil.move(str(tmp_path), target)
    size = target.stat().st_size
    return digest, target, size

def make_run_output_paths(run_id: str, cliente: str, fecha: str) -> dict[str, Path]:
    base = f"{cliente}-hardening"
    return {
        "t1_normal":   OUTPUTS_DIR / f"{base}-control-statics-{fecha}.csv",
        "t1_ajustada": OUTPUTS_DIR / f"{base}-control-statics-{fecha}-ajustada.csv",
        "t2_normal":   OUTPUTS_DIR / f"{base}-result-{fecha}.csv",
        "t2_ajustada": OUTPUTS_DIR / f"{base}-result-{fecha}-ajustada.csv",
    }
