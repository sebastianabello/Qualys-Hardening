from pydantic import BaseModel
from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parents[1]
STORAGE_DIR = BASE_DIR / "storage"
UPLOADS_DIR = STORAGE_DIR / "uploads"
OUTPUTS_DIR = STORAGE_DIR / "outputs"
LOGS_DIR = STORAGE_DIR / "logs"

for d in (UPLOADS_DIR, OUTPUTS_DIR, LOGS_DIR):
    d.mkdir(parents=True, exist_ok=True)

class ESConfig(BaseModel):
    url: str = os.getenv("ES_URL", "https://localhost:9200")
    username: str | None = os.getenv("ES_USER")
    password: str | None = os.getenv("ES_PASS")
    index_t1: str = os.getenv("ES_INDEX_T1", "qualys-t1")
    index_t2: str = os.getenv("ES_INDEX_T2", "qualys-t2")

ES = ESConfig()
