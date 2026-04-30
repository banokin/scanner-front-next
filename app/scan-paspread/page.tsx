"use client";

import { AlertCircle, Loader2, Scan, Upload } from "lucide-react";
import { useCallback, useState } from "react";
import { scanPassportPaspread, type ScanResponse } from "@/lib/api/passport";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"]);

export default function ScanPaspreadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);

  const onFileChosen = useCallback((selected: File | null) => {
    if (!selected) return;
    const isPdf = selected.type === "" && selected.name.toLowerCase().endsWith(".pdf");
    if (!ALLOWED_TYPES.has(selected.type) && !isPdf) {
      setError("Поддерживаются PNG, JPG, JPEG, WEBP и PDF.");
      return;
    }
    console.info("[scan-paspread-page] file:selected", {
      name: selected.name,
      size: selected.size,
      type: selected.type,
    });
    setFile(selected);
    setResult(null);
    setError(null);
  }, []);

  const handleScan = async () => {
    if (!file) return;
    console.info("[scan-paspread-page] scan:start");
    setScanning(true);
    setError(null);
    try {
      const payload = await scanPassportPaspread(file);
      console.info("[scan-paspread-page] scan:success", { model: payload.model });
      setResult(payload);
    } catch (e: unknown) {
      console.error("[scan-paspread-page] scan:failed", e);
      setResult(null);
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="relative min-h-screen text-black">
      <div className="relative mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <section className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-9">
          <h1 className="mb-2 text-xl font-semibold tracking-tight text-black">Эксперимент: paspread / rupasportread</h1>
          <p className="mb-6 text-sm text-slate-600">
            Проверка библиотеки из <a className="text-blue-600 underline" href="https://github.com/grmnvv/paspread" target="_blank">grmnvv/paspread</a>: MRZ паспорта РФ через OpenCV + Tesseract.
          </p>

          <div
            role="button"
            tabIndex={0}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              onFileChosen(e.dataTransfer.files[0] ?? null);
            }}
            onClick={() => document.getElementById("paspread-file")?.click()}
            className={[
              "group relative cursor-pointer rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-all duration-300",
              dragOver
                ? "scale-[1.01] border-blue-500 bg-blue-50"
                : "border-slate-300 hover:border-blue-300 hover:bg-slate-50",
            ].join(" ")}
          >
            <input
              id="paspread-file"
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
            />
            <div className="pointer-events-none flex flex-col items-center gap-2">
              <Upload className="size-6 text-blue-600" aria-hidden />
              <p className="text-sm text-black">Перетащите фото паспорта или нажмите для выбора</p>
              <p className="text-xs text-slate-500">PNG, JPG, WEBP, PDF</p>
              {file && <p className="mt-1 max-w-full truncate font-medium text-blue-700">{file.name}</p>}
            </div>
          </div>

          <button
            type="button"
            disabled={!file || scanning}
            onClick={handleScan}
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-7 py-3.5 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {scanning ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Scan className="size-4" aria-hidden />}
            Проверить paspread
          </button>
        </section>

        {error && (
          <div className="mb-8 flex gap-3 rounded-2xl border border-red-200/80 bg-red-50/90 px-5 py-4 text-sm text-red-900">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden />
            <pre className="whitespace-pre-wrap font-sans">{error}</pre>
          </div>
        )}

        {result && (
          <section className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-8">
            <h2 className="mb-2 text-lg font-semibold text-black">Результат</h2>
            <p className="mb-4 text-xs text-slate-500">model: {result.model}</p>
            <pre className="max-h-[min(560px,60vh)] overflow-auto rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs leading-relaxed text-slate-100 shadow-inner">
              {JSON.stringify(result, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}
