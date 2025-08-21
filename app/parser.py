from __future__ import annotations
from dataclasses import dataclass
from typing import Iterable, Iterator, Optional, Callable
import csv, io, time, os
from pathlib import Path
from .utils import (
    extract_operating_system, has_domain_controller, is_adjusted,
    make_scan_name, make_periodo
)

MARK_T1 = "Control Statistics"
MARK_T2 = "RESULTS"

ProgressCb = Callable[[dict], None]

def _clean_marker_line(s: str) -> str:
    return s.strip().strip('"').strip("'")

def is_marker(line: str) -> Optional[str]:
    c = _clean_marker_line(line)
    if c.lower() == MARK_T1.lower():
        return MARK_T1
    if c.lower() == MARK_T2.lower():
        return MARK_T2
    return None

class PushbackIter:
    def __init__(self, it: Iterable[str]):
        self._it = iter(it)
        self._buf: list[str] = []
    def push(self, line: str) -> None:
        self._buf.append(line)
    def __iter__(self): return self
    def __next__(self) -> str:
        if self._buf:
            return self._buf.pop()
        return next(self._it)

def table_line_generator(src: PushbackIter) -> Iterator[str]:
    """Yield lines belonging to the current table, stopping before the next marker or strong blank line."""
    for line in src:
        if is_marker(line):
            src.push(line)
            return
        if line.strip() == "":
            return
        yield line

@dataclass
class HeaderUnion:
    t1_normal: list[str]
    t1_ajustada: list[str]
    t2_normal: list[str]
    t2_ajustada: list[str]

def _update_union(cur: list[str], new_cols: list[str]) -> list[str]:
    seen = set(cur)
    for c in new_cols:
        if c not in seen:
            cur.append(c); seen.add(c)
    return cur

def scan_file_headers(path: Path, encoding: str = "utf-8", progress: ProgressCb | None = None) -> 'HeaderUnion':
    t1_n: list[str] = []; t1_a: list[str] = []
    t2_n: list[str] = []; t2_a: list[str] = []

    start = time.time()
    with path.open("rb") as fb:
        total_bytes = fb.seek(0, os.SEEK_END); fb.seek(0)
        txt = io.TextIOWrapper(fb, encoding=encoding, errors="replace", newline="")
        push = PushbackIter(txt)

        # primera línea (metadata)
        try: next(push)
        except StopIteration:
            if progress:
                progress({"file": path.name, "phase": "headers", "rows": 0, "bytes": fb.tell(),
                          "total_bytes": total_bytes, "elapsed_s": time.time()-start})
            return HeaderUnion(t1_n, t1_a, t2_n, t2_a)

        for line in push:
            mark = is_marker(line)
            if not mark:
                continue
            try:
                header_line = next(push)
            except StopIteration:
                break
            header = next(csv.reader([header_line]))
            if mark == MARK_T1:
                t1_n = _update_union(t1_n, header)
                t1_a = _update_union(t1_a, header)
            else:
                t2_n = _update_union(t2_n, header)
                t2_a = _update_union(t2_a, header)
            for _ in table_line_generator(push):
                pass
            # progreso ocasional
            if progress and (fb.tell() % (16 * 1024 * 1024) < 4096):  # aprox cada ~16MB
                progress({"file": path.name, "phase": "headers", "rows": 0, "bytes": fb.tell(),
                          "total_bytes": total_bytes, "elapsed_s": time.time()-start})

    if progress:
        progress({"file": path.name, "phase": "headers", "rows": 0, "bytes": total_bytes,
                  "total_bytes": total_bytes, "elapsed_s": time.time()-start})
    return HeaderUnion(t1_n, t1_a, t2_n, t2_a)

def _ensure_extra_cols_for_table1(base: list[str]) -> list[str]:
    cols = list(base)
    for c in ("operating system", "scan_name", "periodo"):
        if c not in cols: cols.append(c)
    return cols

def _ensure_extra_cols_for_table2(base: list[str]) -> list[str]:
    cols = list(base)
    for c in ("Operating System", "scan_name", "periodo"):
        if c not in cols: cols.append(c)
    return cols

def process_file(
    path: Path,
    *,
    union: 'HeaderUnion',
    cliente: str,
    y: int, m: int, d: int,
    writers: dict[str, csv.DictWriter],
    counts: dict[str, int],
    encoding: str = "utf-8",
    log: Callable[[str], None] | None = None,
    progress: ProgressCb | None = None,
) -> None:
    start = time.time()
    rows_total = 0
    with path.open("rb") as fb:
        total_bytes = fb.seek(0, os.SEEK_END); fb.seek(0)
        txt = io.TextIOWrapper(fb, encoding=encoding, errors="replace", newline="")
        push = PushbackIter(txt)

        def emit_prog(phase: str):
            if progress:
                progress({
                    "file": path.name, "phase": phase,
                    "rows": rows_total, "bytes": fb.tell(),
                    "total_bytes": total_bytes,
                    "elapsed_s": time.time() - start
                })

        try:
            first_line = next(push)
        except StopIteration:
            emit_prog("data")
            return
        adjusted = is_adjusted(first_line)
        os_name = extract_operating_system(first_line)
        domain_flag = has_domain_controller(first_line)
        if os_name and domain_flag:
            os_name = f"{os_name} Domain Controller"

        for line in push:
            mark = is_marker(line)
            if not mark:
                continue
            try:
                header_line = next(push)
            except StopIteration:
                break
            hdr = next(csv.reader([header_line]))
            reader = csv.reader(table_line_generator(push))

            if mark == MARK_T1:
                target = "t1_ajustada" if adjusted else "t1_normal"
                fieldnames = _ensure_extra_cols_for_table1(
                    union.t1_ajustada if adjusted else union.t1_normal
                )
                dw = writers[target]
                scan_name = make_scan_name(cliente, y, m, d, es_control_static=True, es_ajustada=adjusted)
                periodo = make_periodo(y, m, d)
                if counts[target] == 0:
                    dw.writeheader()
                for row in reader:
                    record = {k: "" for k in fieldnames}
                    for k, v in zip(hdr, row):
                        record[k] = v
                    record["operating system"] = os_name or ""
                    record["scan_name"] = scan_name
                    record["periodo"] = periodo
                    dw.writerow(record)
                    counts[target] += 1
                    rows_total += 1
                    if rows_total % 2000 == 0:
                        emit_prog("data")

            else:
                target = "t2_ajustada" if adjusted else "t2_normal"
                fieldnames = _ensure_extra_cols_for_table2(
                    union.t2_ajustada if adjusted else union.t2_normal
                )
                dw = writers[target]
                scan_name = make_scan_name(cliente, y, m, d, es_control_static=False, es_ajustada=adjusted)
                periodo = make_periodo(y, m, d)
                if counts[target] == 0:
                    dw.writeheader()
                for row in reader:
                    record = {k: "" for k in fieldnames}
                    for k, v in zip(hdr, row):
                        record[k] = v
                    if domain_flag:
                        record["Operating System"] = (record.get("Operating System") or "").rstrip()
                        if record["Operating System"]:
                            record["Operating System"] += " Domain Controller"
                        else:
                            record["Operating System"] = "Domain Controller"
                    record["scan_name"] = scan_name
                    record["periodo"] = periodo
                    dw.writerow(record)
                    counts[target] += 1
                    rows_total += 1
                    if rows_total % 2000 == 0:
                        emit_prog("data")
        emit_prog("data")
