import { useMemo, useState } from "react";
import UploadArea from "./components/UploadArea";
import ArtifactsPanel from "./components/ArtifactsPanel";
import { uploadFile, startProcess, streamLogs, fetchResults, pushToES } from "./api";
import { FileSpreadsheet, CheckCircle2, X, Play, Calendar, Building2, Loader2 } from "lucide-react";

/* ================= Types & helpers ================= */

type ProgressEvt = {
  file: string; phase: "headers" | "data";
  rows: number; bytes: number; total_bytes: number;
  rows_per_sec: number; mb_per_sec: number;
};

type Artifact = { name: string; url: string; rows?: number | null; size?: number | null };

function progressGradient(phase: string, pct: number) {
  if (pct >= 100) return "bg-gradient-to-r from-emerald-500 to-green-600";
  if (phase === "headers") return "bg-gradient-to-r from-amber-400 to-orange-500";
  return "bg-gradient-to-r from-sky-500 to-indigo-600";
}

function FileBadge({ done }: { done: boolean }) {
  return (
    <div
      className={`shrink-0 h-9 w-9 rounded-xl border flex items-center justify-center
      ${done ? "text-emerald-600 border-emerald-200 bg-emerald-50"
             : "text-emerald-600 border-emerald-200 bg-emerald-50"}`}
    >
      {done ? <CheckCircle2 className="h-5 w-5" /> : <FileSpreadsheet className="h-5 w-5" />}
    </div>
  );
}

function formatBytes(n?: number | null) {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/* ================= App ================= */

export default function App() {
  // Cliente + fecha (requeridos por /api/process)
  const [cliente, setCliente] = useState("BigCo");
  const [fecha, setFecha] = useState<string>("");

  // Archivos seleccionados & subidos (solo CSV)
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<{ id: string; name: string }[]>([]);

  // Proceso
  const [run, setRun] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEvt>>({});
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [confirmed, setConfirmed] = useState(false);
  const [ingesting, setIngesting] = useState(false);

  /* ------- Upload ------- */
  async function addFiles(list: File[]) {
    const csvs = list.filter(f => /\.csv$/i.test(f.name));
    const ignored = list.length - csvs.length;
    if (ignored > 0) setLogs(l => [...l, `Ignorados ${ignored} archivo(s) no-CSV.`]);

    setFiles(prev => [...prev, ...csvs]);

    for (const f of csvs) {
      try {
        const r = await uploadFile(f);
        setUploads(u => [...u, { id: r.upload_id, name: r.filename }]);
        setLogs(l => [...l, `Subido: ${r.filename} (${r.size} bytes)`]);
      } catch (e: any) {
        setError(`Error subiendo ${f.name}: ${e?.message ?? e}`);
      }
    }
  }

  function removeFile(name: string, size: number, lastModified: number) {
    const key = `${name}-${size}-${lastModified}`;
    setFiles(fs => fs.filter(f => `${f.name}-${f.size}-${(f as any).lastModified}` !== key));
    setUploads(us => us.filter(u => u.name !== name));
  }

  const canProcess = useMemo(() => cliente && fecha && uploads.length > 0, [cliente, fecha, uploads]);

  /* ------- Proceso ------- */
  async function onStart() {
    if (!canProcess) {
      setError("Completa cliente, fecha y sube al menos un archivo CSV.");
      return;
    }
    setError(null); setNotice(null); setProcessing(true);
    try {
      const ids = uploads.map(u => u.id);
      const start = await startProcess(cliente, fecha, ids);
      setRun(start.run_id);
      setLogs(l => [...l, `Run: ${start.run_id}`]);

      // SSE: progreso/logs
      const close = streamLogs(start.run_id, (line) => {
        try {
          const evt = JSON.parse(line);
          if (evt.type === "progress") {
            setProgress(p => ({ ...p, [evt.file]: evt as ProgressEvt }));
          } else if (evt.type === "log") {
            setLogs(l => [...l, evt.message]);
          } else {
            setLogs(l => [...l, line]);
          }
        } catch {
          setLogs(l => [...l, line]); // texto plano
        }
      });

      // Poll de resultados -> artifacts con rows (y luego tamaños por HEAD)
      setTimeout(async () => {
        const res = await fetchResults(start.run_id);
        let arts: Artifact[] = (res.files || []).map((f: any) => ({
          name: f.name,
          url: f.url,
          rows: typeof f.rows === "number" ? f.rows : null,
          size: typeof f.size === "number" ? f.size : null,
        }));
        setArtifacts(arts);
        close();

        // Completar tamaños con HEAD si no vinieron en results
        arts.forEach(async (a, idx) => {
          if (a.size == null && a.url) {
            try {
              const head = await fetch(a.url, { method: "HEAD" });
              const len = head.headers.get("content-length");
              if (len) {
                const n = parseInt(len, 10);
                setArtifacts(prev => {
                  const clone = [...prev];
                  clone[idx] = { ...clone[idx], size: Number.isFinite(n) ? n : null };
                  return clone;
                });
              }
            } catch { /* ignore */ }
          }
        });

        const totalRows = arts.reduce((a, b) => a + (b.rows || 0), 0);
        setNotice(`Procesamiento OK · ${uploads.length} archivo(s) · ${totalRows} fila(s)`);
      }, 3500);
    } catch (e: any) {
      setError(`No se pudo procesar: ${e?.message ?? e}`);
    } finally {
      setProcessing(false);
    }
  }

  /* ------- Ingesta ------- */
  async function onIngest() {
    if (!run) return;
    try {
      setIngesting(true);
      const r = await pushToES(run);
      setNotice(`Indexados: ${r.total_docs - r.failed} · fallidos: ${r.failed}`);
    } catch (e:any) {
      setError(`Error de ingesta: ${e?.message ?? e}`);
    } finally {
      setIngesting(false);
    }
  }

  /* ------- UI ------- */
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Qualys Hardening</h1>
          <p className="text-sm text-slate-500 -mt-1">Procesa CSV grandes · Control Statistics & RESULTS</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm">
            <Building2 className="h-4 w-4 text-slate-500" />
            <select value={cliente} onChange={(e) => setCliente(e.target.value)} className="bg-transparent outline-none">
              <option>BigCo</option>
              <option>Globex</option>
              <option>Initech</option>
            </select>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm">
            <Calendar className="h-4 w-4 text-slate-500" />
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="bg-transparent outline-none"/>
          </div>
        </div>
      </header>

      {/* Carga + seleccionados */}
      <div className="grid md:grid-cols-2 gap-4">
        <UploadArea onAddFiles={addFiles} />

        <section className="bg-white rounded-2xl shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-700">Archivos seleccionados <span className="text-slate-400">({files.length})</span></div>
            <button
              className="text-xs px-2 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50"
              disabled={files.length === 0}
              onClick={() => { setFiles([]); setUploads([]); }}
            >Limpiar</button>
          </div>

          {/* Chips */}
          <div className="mt-3 flex flex-wrap gap-2 max-h-40 overflow-auto pr-1">
            {files.map(f => {
              const key = `${f.name}-${f.size}-${(f as any).lastModified}`;
              return (
                <span key={key} className="inline-flex items-center gap-2 bg-slate-100 px-3 py-1 rounded-full text-sm">
                  <FileSpreadsheet size={16} className="text-emerald-600"/>
                  <span className="truncate max-w-[260px]" title={f.name}>{f.name}</span>
                  <button className="text-slate-500 hover:text-slate-900"
                    onClick={() => removeFile(f.name, f.size, (f as any).lastModified)}
                    title="Quitar"><X size={14}/></button>
                </span>
              );
            })}
            {files.length === 0 && <span className="text-sm text-slate-500">Aún no hay archivos.</span>}
          </div>

          <button
            className="w-full mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            onClick={onStart}
            disabled={processing || !canProcess}
            title={!canProcess ? "Completa cliente, fecha y sube al menos un archivo CSV" : "Procesar"}
          >
            {processing ? <Loader2 className="animate-spin h-4 w-4"/> : <Play className="h-4 w-4" />}
            {processing ? "Procesando…" : "Procesar"}
          </button>
        </section>
      </div>

      {/* Progreso por archivo */}
      {Object.keys(progress).length > 0 && (
        <section className="bg-white rounded-2xl shadow-sm p-4">
          <h3 className="font-semibold text-slate-800 mb-3">Progreso por archivo</h3>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Object.values(progress).map((p) => {
              const pct = p.total_bytes ? Math.min(100, Math.round((p.bytes / p.total_bytes) * 100)) : 0;
              return (
                <div key={p.file} className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex items-center gap-3">
                    <FileBadge done={pct >= 100} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <div className="truncate font-mono text-sm">{p.file}</div>
                        <span className="text-xs text-slate-500">{p.phase}</span>
                      </div>

                      {/* barra con gradiente */}
                      <div className="w-full h-2 bg-slate-200 rounded mt-2 overflow-hidden">
                        <div className={`h-2 ${progressGradient(p.phase, pct)}`} style={{ width: `${pct}%` }} />
                      </div>

                      <div className="text-xs text-slate-600 mt-2">
                        {pct}% · filas/s: {p.rows_per_sec} · MB/s: {p.mb_per_sec}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Mensajes */}
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-2xl p-3">{notice}</div>}
      {error &&   <div className="bg-amber-50  border border-amber-200  text-amber-800  rounded-2xl p-3">{error}</div>}

      {/* Resultados e Ingesta */}
      {artifacts.length > 0 && (
        <ArtifactsPanel
          artifacts={artifacts.map(a => ({
            name: a.name,
            download_url: a.url,
            size: a.size ?? undefined,
            rows: a.rows ?? undefined,
          }))}
          onIngest={onIngest}
          confirmed={confirmed}
          setConfirmed={setConfirmed}
          ingesting={ingesting}
        />
      )}

      {/* Logs crudos */}
      <section className="bg-white rounded-2xl shadow-sm p-4">
        <h3 className="font-semibold text-slate-800">Logs</h3>
        <pre className="bg-slate-50 border border-slate-200 rounded mt-2 p-3 h-56 overflow-auto text-xs">
{logs.join("\n")}
        </pre>
      </section>
    </div>
  );
}
