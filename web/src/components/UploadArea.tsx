import { Upload, FileArchive, FileText } from "lucide-react";
import React from "react";

interface Props { onAddFiles: (files: File[]) => void }

export default function UploadArea({ onAddFiles }: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = React.useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => /\.csv$/i.test(f.name));
    if (files.length) onAddFiles(files);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
      className={`bg-white rounded-2xl shadow-sm p-8 text-center border-2 border-dashed transition-colors
                 ${isOver ? "border-slate-400" : "border-slate-300"}`}
    >
      <Upload className="mx-auto text-slate-600" size={32} />
      <h3 className="mt-3 text-lg font-medium text-slate-800">Arrastra CSV</h3>
      <p className="text-sm text-slate-500">Puedes añadir en varias tandas</p>

      <button
        type="button"
        className="mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800"
        onClick={() => inputRef.current?.click()}
      >
        Seleccionar archivos
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".csv"
        className="hidden"
        onChange={e => {
          const list = e.target.files ? Array.from(e.target.files) : [];
          if (list.length) onAddFiles(list);
          e.currentTarget.value = ""; // permite volver a elegir el mismo archivo
        }}
      />

      <div className="flex items-center justify-center gap-6 mt-6 text-slate-600">
        <span className="inline-flex items-center gap-2 text-sm"><FileText size={16}/> CSV</span>
      </div>
    </div>
  );
}
