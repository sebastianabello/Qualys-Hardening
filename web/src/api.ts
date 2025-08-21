export async function uploadFile(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/upload", { method: "POST", body: fd });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function startProcess(cliente: string, fecha: string, files: string[]) {
  const r = await fetch("/api/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cliente, fecha, files }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json(); // { run_id }
}

export function streamLogs(run_id: string, onMsg: (s: string) => void) {
  const ev = new EventSource(`/api/runs/${run_id}/logs`);
  ev.onmessage = (e) => onMsg(e.data);
  return () => ev.close();
}

export async function fetchResults(run_id: string) {
  const r = await fetch(`/api/runs/${run_id}/results`);
  if (!r.ok) throw new Error(await r.text());
  return r.json(); // { files:[{name,url,rows,...}] }
}

export async function pushToES(run_id: string) {
  const r = await fetch(`/api/runs/${run_id}/push-to-es`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json(); // { total_docs, failed, details[...] }
}


import type { Artifact, ProcessResponse, Counts } from "../types";

// Helpers básicos ------------------------------------------------------------
async function jsonOrThrow(r: Response) {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} · ${await r.text().catch(()=> "")}`);
  return r.json();
}
async function uploadOne(file: File): Promise<{ upload_id: string; filename: string; size: number }> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/upload", { method: "POST", body: fd });
  return jsonOrThrow(r);
}
function todayStr(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Core: processFiles ---------------------------------------------------------
export async function processFiles(
  files: File[],
  cliente: string,
  empresas: string[],
  // `scanNameClient` no lo usa el backend aún; lo dejamos por compat
  _scanNameClient?: string,
): Promise<ProcessResponse> {
  // 1) Subir archivos
  const uploaded = await Promise.all(files.map(uploadOne));
  const uploadIds = uploaded.map(u => u.upload_id);

  // 2) Iniciar proceso (usa fecha actual)
  const body = { cliente, fecha: todayStr(), files: uploadIds };
  const start = await fetch("/api/process", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then(jsonOrThrow);
  const run_id: string = start.run_id;

  // 3) Poll de resultados sencillito
  const startTime = Date.now();
  let results: any = null;
  while (Date.now() - startTime < 120_000) { // 2 min
    await new Promise(r => setTimeout(r, 1500));
    const r = await fetch(`/api/runs/${run_id}/results`);
    if (r.ok) { results = await r.json(); break; }
  }
  if (!results) throw new Error("Timeout esperando resultados");

  // 4) Adaptar a la forma que usa tu UI
  // results.files: [{name, url, rows, cols, warnings[]}...]
  const counts: Counts = {};
  const artifacts: Artifact[] = [];
  const source_files = uploaded.map(u => u.filename);

  for (const f of results.files as Array<any>) {
    // el key viene en la URL: /api/download/{run_id}/{key}
    const key = (f.url as string).split("/").pop() || "";
    counts[key as keyof Counts] = f.rows;
    artifacts.push({
      name: f.name,
      size: 0,                 // tamaño no viene del backend; si quieres lo consultamos con HEAD
      download_url: f.url,
    });
  }

  const out: ProcessResponse = {
    run: { run_id, source_files, counts },
    artifacts,
    preview: { t1_normal: [], t1_ajustada: [], t2_normal: [], t2_ajustada: [] }, // podemos añadir preview real luego
    warnings: results.files?.[0]?.warnings || [],
  };
  return out;
}

// Enviar a Elasticsearch -----------------------------------------------------
export async function ingest(run_id: string): Promise<{ indexed: Record<string, number>; raw: any }> {
  const r = await fetch(`/api/runs/${run_id}/push-to-es`, { method: "POST" });
  const data = await jsonOrThrow(r); // { total_docs, failed, details: [{file, ok, failed}] }

  // Hacemos un pequeño resumen por "tipo" (t1/t2) con base en el nombre del archivo
  const indexed: Record<string, number> = {};
  for (const d of (data.details || [])) {
    const isT1 = String(d.file).includes("tabla1");
    const key = isT1 ? "qualys-t1" : "qualys-t2";
    indexed[key] = (indexed[key] || 0) + Number(d.ok || 0);
  }
  return { indexed, raw: data };
}
