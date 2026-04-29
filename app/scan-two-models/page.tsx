"use client";

import { AlertCircle, Loader2, Scan, Upload } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  scanDocumentsUnifiedTwoModels,
  type UnifiedScanResponse,
} from "@/lib/api/passport";

const MODELS = [
  { key: "qwen30", title: "Qwen 30B", modelId: "Qwen/Qwen2.5-VL-32B-Instruct:novita" },
  {
    key: "llama4",
    title: "Llama 4 Scout",
    modelId: "meta-llama/Llama-4-Scout-17B-16E-Instruct:novita",
  },
] as const;

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const ALLOWED_DOC_MIME_TYPES = new Set([...ALLOWED_IMAGE_MIME_TYPES, "application/pdf"]);

type UploadKey = "passportMain" | "passportRegistration" | "egrnExtract";

const UPLOAD_SLOTS: Array<{ key: UploadKey; title: string; subtitle: string }> = [
  {
    key: "passportMain",
    title: "Фото паспорта (основной разворот)",
    subtitle: "Фото или PDF разворота с фото и персональными данными",
  },
  {
    key: "passportRegistration",
    title: "Фото страницы с пропиской",
    subtitle: "Фото или PDF страницы паспорта с адресом регистрации",
  },
  {
    key: "egrnExtract",
    title: "Фото выписки ЕГРН",
    subtitle: "Фото или PDF выписки с реквизитами (PDF поддерживается)",
  },
];

const isPdfByExtension = (filename: string): boolean => filename.trim().toLowerCase().endsWith(".pdf");

export default function ScanTwoModelsPage() {
  const [files, setFiles] = useState<Record<UploadKey, File | null>>({
    passportMain: null,
    passportRegistration: null,
    egrnExtract: null,
  });
  const [dragOverKey, setDragOverKey] = useState<UploadKey | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, UnifiedScanResponse | null>>({
    qwen30: null,
    llama4: null,
  });

  const onFileChosen = useCallback((key: UploadKey, f: File | null) => {
    if (!f) return;
    const isAllowed = ALLOWED_DOC_MIME_TYPES.has(f.type) || (f.type === "" && isPdfByExtension(f.name));
    if (!isAllowed) {
      setError("Поддерживаются PNG, JPG, JPEG, WEBP и PDF.");
      return;
    }
    setFiles((prev) => ({ ...prev, [key]: f }));
    setResults({ qwen30: null, llama4: null });
    setError(null);
  }, []);

  const allFilesSelected = Boolean(files.passportMain && files.passportRegistration && files.egrnExtract);

  const handleScan = async () => {
    if (!allFilesSelected || !files.passportMain || !files.passportRegistration || !files.egrnExtract) return;
    setScanning(true);
    setError(null);
    try {
      const payload = {
        passportMain: files.passportMain,
        passportRegistration: files.passportRegistration,
        egrnExtract: files.egrnExtract,
      };
      const response = await scanDocumentsUnifiedTwoModels(payload);
      setResults({
        qwen30: response.data.qwen30 ?? null,
        llama4: response.data.llama4scout ?? null,
      });
    } catch (e: unknown) {
      setResults({ qwen30: null, llama4: null });
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setScanning(false);
    }
  };

  const modelCards = useMemo(
    () =>
      MODELS.map((m) => ({
        ...m,
        result: results[m.key],
      })),
    [results],
  );

  return (
    <div className="relative min-h-screen text-black">
      <div className="relative mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <section className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-9">
          <h1 className="mb-2 text-xl font-semibold tracking-tight text-black">Сканирование 3 документов</h1>
          <p className="mb-6 text-sm text-slate-600">
            Копия HF-страницы для анализа сразу по двум моделям: Qwen 30B и Llama 4 Scout.
          </p>

          <div className="space-y-5">
            {UPLOAD_SLOTS.map((slot) => {
              const inputId = `${slot.key}-input`;
              const slotFile = files[slot.key];
              const isDragOver = dragOverKey === slot.key;
              return (
                <div key={slot.key}>
                  <div className="mb-3 flex items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-slate-200/90">
                      <Upload className="size-4 text-(--ph-accent)" aria-hidden />
                    </span>
                    <div>
                      <label htmlFor={inputId} className="text-sm font-semibold text-black">
                        {slot.title}
                      </label>
                      <p className="text-xs text-black">{slot.subtitle}</p>
                    </div>
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverKey(slot.key);
                    }}
                    onDragLeave={() => setDragOverKey(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverKey(null);
                      onFileChosen(slot.key, e.dataTransfer.files[0] ?? null);
                    }}
                    onClick={() => document.getElementById(inputId)?.click()}
                    className={[
                      "group relative cursor-pointer rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-all duration-300",
                      isDragOver
                        ? "scale-[1.01] border-(--ph-accent) bg-(--ph-glow) shadow-[0_0_0_4px_rgba(37,99,235,0.18)]"
                        : "border-(--ph-drop-border) hover:border-(--ph-drop-border-hover) hover:bg-(--ph-surface)",
                    ].join(" ")}
                  >
                    <input
                      id={inputId}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf,.pdf"
                      className="sr-only"
                      onChange={(e) => onFileChosen(slot.key, e.target.files?.[0] ?? null)}
                    />
                    <div className="pointer-events-none flex flex-col items-center gap-2">
                      <p className="text-sm text-black">Перетащите файл или нажмите для выбора</p>
                      <p className="text-xs text-black">PNG, JPG, JPEG, WEBP, PDF</p>
                      {slotFile && (
                        <p className="mt-1 max-w-full truncate font-medium text-(--ph-accent)">
                          {slotFile.name}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              disabled={!allFilesSelected || scanning}
              onClick={handleScan}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-7 py-3.5 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {scanning ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Scan className="size-4" aria-hidden />}
              Сканировать 2 моделями
            </button>
          </div>
        </section>

        {error && (
          <div className="mb-8 flex gap-3 rounded-2xl border border-red-200/80 bg-red-50/90 px-5 py-4 text-sm text-red-900">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden />
            <pre className="whitespace-pre-wrap font-sans">{error}</pre>
          </div>
        )}

        {modelCards.map((card) =>
          card.result ? (
            <section
              key={card.key}
              className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-8"
            >
              <h2 className="mb-3 text-lg font-semibold text-black">{card.title}</h2>
              <p className="mb-4 text-xs text-slate-500">model: {card.result.model}</p>
              <pre className="max-h-[min(520px,60vh)] overflow-auto rounded-2xl border border-(--ph-border) bg-(--ph-pre-bg) p-4 text-xs leading-relaxed text-(--ph-muted) shadow-inner">
                {JSON.stringify(card.result, null, 2)}
              </pre>
            </section>
          ) : null,
        )}
      </div>
    </div>
  );
}
