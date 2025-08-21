import { Download, Database, FileSpreadsheet, Loader2 } from "lucide-react";

type Artifact = {
  name: string;
  download_url: string;
  size?: number;
  rows?: number;
};

type Props = {
  artifacts: Artifact[];
  onIngest: () => void;
  confirmed: boolean;
  setConfirmed: (v: boolean) => void;
  ingesting?: boolean; // opcional
};

function labelFromName(name: string) {
  const isControl = name.toLowerCase().includes("-control-statics");
  const isAjust = name.toLowerCase().includes("-ajustado");
  const base = isControl ? "Control Statistics" : "Results";
  return base + (isAjust ? " · Ajustada" : "");
}

function formatBytes(n?: number) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export default function ArtifactsPanel({
  artifacts,
  onIngest,
  confirmed,
  setConfirmed,
  ingesting = false,
}: Props) {
  const totalRows = artifacts.reduce((a, b) => a + (b.rows || 0), 0);

  return (
    <section className="bg-white rounded-2xl shadow-sm p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">CSV generados (hasta 4)</h3>
        <span className="text-xs text-slate-500">{totalRows} filas</span>
      </div>

      <ul className="divide-y divide-slate-200">
        {artifacts.map((a) => (
          <li key={a.name} className="py-2 flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-start gap-3">
              <div className="mt-0.5">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate" title={a.name}>
                  {a.name}
                </div>
                <div className="text-xs text-slate-500">
                  {labelFromName(a.name)} · {a.rows ?? "—"} filas · {formatBytes(a.size)}
                </div>
              </div>
            </div>
            <a
              href={a.download_url}
              className="text-slate-900 inline-flex items-center gap-1 text-sm"
            >
              <Download size={16} /> Descargar
            </a>
          </li>
        ))}
        {artifacts.length === 0 && (
          <li className="py-2 text-sm text-slate-500">Aún no hay archivos generados.</li>
        )}
      </ul>

      <div className="pt-2">
        <div className="font-semibold text-slate-800">Validación e Ingesta</div>
        <p className="text-xs text-slate-500 mt-1">
          Revisa los archivos generados. Al confirmar, se enviarán a Elasticsearch con la
          configuración del backend.
        </p>

        <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          Confirmo que la información es correcta para enviar a Elasticsearch.
        </label>

        <button
          className="mt-3 w-full px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          onClick={onIngest}
          disabled={ingesting || !confirmed || artifacts.length === 0}
        >
          {ingesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database size={18} />}
          {ingesting ? "Ingestando…" : "Enviar a Elasticsearch"}
        </button>
      </div>
    </section>
  );
}
