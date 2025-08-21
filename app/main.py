from fastapi import FastAPI, UploadFile, File, BackgroundTasks
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from pathlib import Path
from datetime import datetime
import tempfile, uuid, csv
import json, time

from .models import UploadResponse, ProcessRequest, ProcessResponse, ResultsResponse, ResultFile, PushToESResponse
from .storage import finalize_upload, make_run_output_paths
from .config import OUTPUTS_DIR, ES
from .parser import scan_file_headers, process_file, _ensure_extra_cols_for_table1, _ensure_extra_cols_for_table2, HeaderUnion
from .es_uploader import ESUploader
from .utils import parse_fecha
from .encoding import detect_encoding

app = FastAPI(title="Qualys CSV Processor")

RUN_LOGS: dict[str, list[str]] = {}
RUN_WARN: dict[str, list[str]] = {}
RUN_FILES: dict[str, dict[str, Path]] = {}
RUN_COUNTS: dict[str, dict[str, int]] = {}
RUN_FNS: dict[str, dict[str, list[str]]] = {}
RUN_HANDLES: dict[str, dict[str, any]] = {}  # file handles para cerrar

@app.post("/api/upload", response_model=UploadResponse)
async def upload(file: UploadFile = File(...)):
    # Escritura streaming a /tmp sin cargar el archivo a RAM
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        total = 0
        while True:
            chunk = await file.read(8 * 1024 * 1024)  # 8MB
            if not chunk: break
            tmp.write(chunk); total += len(chunk)
        tmp_path = Path(tmp.name)
    digest, final_path, size = finalize_upload(tmp_path, file.filename)
    return UploadResponse(upload_id=digest, filename=final_path.name, size=size)

@app.post("/api/process", response_model=ProcessResponse)
async def process(req: ProcessRequest, bg: BackgroundTasks):
    run_id = datetime.utcnow().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    RUN_LOGS[run_id] = []
    RUN_WARN[run_id] = []

    def log(msg: str):
        RUN_LOGS[run_id].append(msg)

    # Resolver paths de uploads por prefijo {upload_id}_
    files: list[Path] = []
    up_dir = Path("storage/uploads")
    for uid in req.files:
        matches = list(up_dir.glob(f"{uid}_*"))
        if not matches:
            RUN_WARN[run_id].append(f"Archivo no encontrado: {uid}")
            continue
        files.append(matches[0])

    if not files:
        RUN_WARN[run_id].append("No hay archivos válidos para procesar.")

    outputs = make_run_output_paths(run_id, req.cliente, req.fecha)
    RUN_FILES[run_id] = outputs
    RUN_COUNTS[run_id] = {k: 0 for k in outputs.keys()}
    RUN_HANDLES[run_id] = {}

    def job():
        # Detectar encoding por archivo
        enc_by_file: dict[Path, str] = {}
        for p in files:
            enc = detect_encoding(p)
            enc_by_file[p] = enc
            log(json.dumps({"type": "log", "message": f"{p.name}: encoding detectado = {enc}"}))

        y, m, d = parse_fecha(req.fecha)

        # 1) Unión de headers por tipo (con progreso)
        t1n: list[str] = []; t1a: list[str] = []
        t2n: list[str] = []; t2a: list[str] = []
        def progress_evt(evt: dict):
            # Calcula tasas promedio usando elapsed_s
            e = max(evt.get("elapsed_s", 0.0), 1e-6)
            evt["rows_per_sec"] = round(evt.get("rows", 0) / e, 2)
            evt["mb_per_sec"] = round((evt.get("bytes", 0) / 1_000_000.0) / e, 2)
            RUN_LOGS[run_id].append(json.dumps({"type": "progress", **evt}))

        for p in files:
            log(json.dumps({"type": "log", "message": f"Escaneando headers: {p.name}"}))
            u = scan_file_headers(p, encoding=enc_by_file[p], progress=progress_evt)
            t1n = list(dict.fromkeys(t1n + u.t1_normal))
            t1a = list(dict.fromkeys(t1a + u.t1_ajustada))
            t2n = list(dict.fromkeys(t2n + u.t2_normal))
            t2a = list(dict.fromkeys(t2a + u.t2_ajustada))


        # 2) Fieldnames finales (incluye columnas extra)
        fns = {
            "t1_normal":   _ensure_extra_cols_for_table1(t1n),
            "t1_ajustada": _ensure_extra_cols_for_table1(t1a),
            "t2_normal":   _ensure_extra_cols_for_table2(t2n),
            "t2_ajustada": _ensure_extra_cols_for_table2(t2a),
        }
        RUN_FNS[run_id] = fns

        # 3) Abrir writers con fieldnames definitivos
        writers: dict[str, csv.DictWriter] = {}
        handles = {}
        for key, path in outputs.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            fh = path.open("w", encoding="utf-8", newline="")
            handles[key] = fh
            writers[key] = csv.DictWriter(fh, fieldnames=fns[key], extrasaction="ignore")

        # 4) Procesar archivos
        for p in files:
            log(json.dumps({"type": "log", "message": f"Procesando: {p.name}"}))
            process_file(
                p,
                union=HeaderUnion(t1n, t1a, t2n, t2a),
                cliente=req.cliente, y=y, m=m, d=d,
                writers=writers, counts=RUN_COUNTS[run_id],
                encoding=enc_by_file[p],
                log=lambda m: RUN_LOGS[run_id].append(json.dumps({"type": "log", "message": m})),
                progress=progress_evt,
            )

        # 5) Cierre de archivos
        for fh in handles.values():
            fh.flush(); fh.close()
        RUN_HANDLES[run_id] = {}

        log("Proceso finalizado")

    bg.add_task(job)
    return ProcessResponse(run_id=run_id)

@app.get("/api/runs/{run_id}/logs")
async def stream_logs(run_id: str):
    async def event_gen():
        last = 0
        import asyncio
        while True:
            logs = RUN_LOGS.get(run_id, [])
            for i in range(last, len(logs)):
                yield f"data: {logs[i]}\n\n"
            last = len(logs)
            if logs and logs[-1] == "Proceso finalizado":
                break
            await asyncio.sleep(0.4)
    return StreamingResponse(event_gen(), media_type="text/event-stream")

@app.get("/api/runs/{run_id}/results", response_model=ResultsResponse)
async def results(run_id: str):
    outs = RUN_FILES.get(run_id)
    counts = RUN_COUNTS.get(run_id, {})
    fns = RUN_FNS.get(run_id, {})
    if not outs:
        return JSONResponse(status_code=404, content={"detail": "run no encontrado"})
    files = []
    for k, p in outs.items():
        rows = max(0, counts.get(k, 0))
        cols = len(fns.get(k, []))
        files.append(ResultFile(
            name=p.name, url=f"/api/download/{run_id}/{k}",
            rows=rows, cols=cols, warnings=RUN_WARN.get(run_id, [])
        ))
    return ResultsResponse(files=files)

@app.get("/api/download/{run_id}/{key}")
async def download(run_id: str, key: str):
    p = RUN_FILES.get(run_id, {}).get(key)
    if not p or not p.exists():
        return JSONResponse(status_code=404, content={"detail": "archivo no encontrado"})
    return FileResponse(p)

@app.post("/api/runs/{run_id}/push-to-es", response_model=PushToESResponse)
async def push_es(run_id: str):
    outs = RUN_FILES.get(run_id)
    if not outs:
        return JSONResponse(status_code=404, content={"detail": "run no encontrado"})
    es = ESUploader(ES.url, ES.username, ES.password)
    total = 0; failed = 0; details: list[dict] = []
    for key, path in outs.items():
        if not path.exists(): continue
        idx = ES.index_t1 if key.startswith("t1_") else ES.index_t2
        ok, fail, det = es.bulk_file(path, idx)
        total += ok + fail; failed += fail
        details.append({"file": path.name, "ok": ok, "failed": fail})
    return PushToESResponse(total_docs=total, failed=failed, details=details)
