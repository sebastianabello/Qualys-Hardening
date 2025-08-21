from elasticsearch import Elasticsearch, helpers
from pathlib import Path
import csv
from typing import Iterator

class ESUploader:
    def __init__(self, url: str, username: str | None, password: str | None):
        self.client = Elasticsearch(
            url,
            basic_auth=(username, password) if username and password else None,
            request_timeout=120
        )

    def _iter_csv(self, path: Path, index: str) -> Iterator[dict]:
        with path.open("r", encoding="utf-8", errors="replace", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                yield {"_index": index, "_source": row}

    def bulk_file(self, path: Path, index: str, *, chunk_size: int = 5000) -> tuple[int, int, list[dict]]:
        ok = 0; fail = 0; details: list[dict] = []
        for success, info in helpers.streaming_bulk(
            self.client, self._iter_csv(path, index),
            chunk_size=chunk_size, max_retries=3, raise_on_error=False
        ):
            if success: ok += 1
            else:
                fail += 1
                details.append(info)
        return ok, fail, details
