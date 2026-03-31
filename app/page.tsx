"use client";

import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileDown,
  FileText,
  Loader2,
  Scan,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildContractFromPassport,
  type PassportData,
  scanPassport,
  type ScanResponse,
} from "@/lib/api/passport";
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const FIELD_LABELS: Record<keyof PassportData, string> = {
  issuing_authority: "Кем выдан",
  issue_date: "Дата выдачи",
  department_code: "Код подразделения",
  passport_series: "Серия",
  passport_number: "Номер",
  surname: "Фамилия",
  name: "Имя",
  patronymic: "Отчество",
  gender: "Пол",
  birth_date: "Дата рождения",
  birth_place: "Место рождения",
  confidence_note: "Примечание модели",
};

export default function PassportHfPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploadSnapshot, setUploadSnapshot] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [contractBlob, setContractBlob] = useState<Blob | null>(null);
  const [contractFilename, setContractFilename] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [buildingContract, setBuildingContract] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFullJson, setShowFullJson] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);

  const resetForNewFile = useCallback(() => {
    setScanResult(null);
    setUploadSnapshot(null);
    setContractBlob(null);
    setContractFilename(null);
    setError(null);
    setShowFullJson(false);
    setRawOpen(false);
  }, []);

  const onFileChosen = useCallback(
    (f: File | null) => {
      if (!f) return;
      if (!ALLOWED_IMAGE_MIME_TYPES.has(f.type)) {
        setError("Поддерживаются только PNG, JPG, JPEG и WEBP.");
        return;
      }
      setFile(f);
      resetForNewFile();
    },
    [resetForNewFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) onFileChosen(f);
    },
    [onFileChosen],
  );

  const handleScan = async () => {
    if (!file) return;
    setError(null);
    setScanning(true);
    setContractBlob(null);
    setContractFilename(null);
    try {
      const data = await scanPassport(file);
      setScanResult(data);
      setUploadSnapshot(file);
    } catch (e: unknown) {
      setScanResult(null);
      setUploadSnapshot(null);
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setScanning(false);
    }
  };

  const handleBuildContract = async () => {
    const sourceFile = uploadSnapshot ?? file;
    if (!sourceFile || !scanResult) return;
    setError(null);
    setBuildingContract(true);
    try {
      const result = await buildContractFromPassport(sourceFile);
      setContractBlob(result.blob);
      setContractFilename(result.filename);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setBuildingContract(false);
    }
  };

  const dataEntries = useMemo(() => {
    if (!scanResult?.data) return [];
    return (Object.keys(FIELD_LABELS) as (keyof PassportData)[]).map((key) => ({
      key,
      label: FIELD_LABELS[key],
      value: scanResult.data[key]?.toString().trim() ?? "",
    }));
  }, [scanResult]);

  const [downloadHref, setDownloadHref] = useState<string | null>(null);

  useEffect(() => {
    if (!contractBlob) {
      setDownloadHref(null);
      return;
    }
    const url = URL.createObjectURL(contractBlob);
    setDownloadHref(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [contractBlob]);

  return (
    <div className="relative min-h-screen">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <div className="absolute -left-24 top-40 h-96 w-96 rounded-full bg-slate-200/40 blur-3xl" />
        <div className="absolute -right-20 top-[480px] h-80 w-80 rounded-full bg-blue-100/50 blur-3xl" />
        <div className="absolute bottom-32 left-1/4 h-72 w-72 rounded-full bg-sky-100/40 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <section className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-9">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-slate-200/90">
              <Upload className="size-5 text-[color:var(--ph-accent)]" aria-hidden />
            </span>
            <div>
              <label
                htmlFor="passport-file-input"
                className="text-base font-semibold text-[color:var(--ph-ink)]"
              >
                Фото паспорта
              </label>
              <p className="text-xs text-[color:var(--ph-muted)]">
                Чёткое изображение разворота с фото
              </p>
            </div>
          </div>
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              document.getElementById("passport-file-input")?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById("passport-file-input")?.click()}
          className={[
            "group relative cursor-pointer rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-all duration-300",
            dragOver
              ? "scale-[1.01] border-[color:var(--ph-accent)] bg-[color:var(--ph-glow)] shadow-[0_0_0_4px_rgba(37,99,235,0.18)]"
              : "border-[color:var(--ph-drop-border)] hover:border-[color:var(--ph-drop-border-hover)] hover:bg-[color:var(--ph-surface)]",
          ].join(" ")}
        >
          <input
            id="passport-file-input"
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            className="sr-only"
            onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
          />
          <div className="pointer-events-none flex flex-col items-center gap-3">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-white to-blue-50/80 shadow-sm ring-1 ring-blue-100 transition group-hover:ring-[color:var(--ph-accent-dim)] group-hover:shadow-md">
              <Upload className="size-6 text-[color:var(--ph-accent)]" aria-hidden />
            </div>
            <p className="text-sm text-[color:var(--ph-muted)]">
              Перетащите файл сюда или нажмите для выбора
            </p>
            <p className="text-xs text-[color:var(--ph-faint)]">PNG, JPG, JPEG, WEBP</p>
            {file && (
              <p className="mt-2 max-w-full truncate font-medium text-[color:var(--ph-accent)]">
                {file.name}
                <span className="ml-2 font-normal text-[color:var(--ph-muted)]">
                  ({(file.size / 1024).toFixed(1)} KB)
                </span>
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            disabled={!file || scanning}
            onClick={handleScan}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-7 py-3.5 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {scanning ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Scan className="size-4" aria-hidden />
            )}
            Сканировать 
          </button>
          {scanning && (
            <p className="flex items-center gap-2 text-sm text-[color:var(--ph-muted)]">
              <Loader2 className="size-4 shrink-0 animate-spin text-[color:var(--ph-accent)]" />
              Сканирую паспорт 
            </p>
          )}
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="mb-8 flex gap-3 rounded-2xl border border-red-200/80 bg-red-50/90 px-5 py-4 text-sm text-red-900 shadow-[0_8px_30px_-12px_rgba(185,28,28,0.2)] backdrop-blur-sm"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden />
          <pre className="whitespace-pre-wrap font-sans">{error}</pre>
        </div>
      )}

      {scanResult && (
        <>
          <section className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-8">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div className="flex items-center gap-3">
                <span
                  className="hidden h-9 w-1 shrink-0 rounded-full bg-gradient-to-b from-blue-600 to-sky-400 sm:block"
                  aria-hidden
                />
                <h2 className="text-xl font-semibold tracking-tight text-[color:var(--ph-ink)]">
                  Данные паспорта
                </h2>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 shadow-sm">
                Модель
                <code className="rounded-md bg-white px-2 py-0.5 font-medium text-blue-600 ring-1 ring-slate-200/80">
                  {scanResult.model}
                </code>
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {dataEntries.map(({ key, label, value }) => (
                <div
                  key={key}
                  className="rounded-2xl border border-slate-200/90 bg-slate-50/50 px-4 py-3.5 shadow-sm transition hover:border-blue-200/80 hover:bg-white hover:shadow-md"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--ph-muted)]">
                    {label}
                  </div>
                  <div className="mt-1.5 break-words text-sm font-medium leading-snug text-[color:var(--ph-ink)]">
                    {value || "—"}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowFullJson((v) => !v)}
              className="mt-5 inline-flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm font-medium text-blue-600 transition hover:bg-slate-100"
            >
              {showFullJson ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
              Показать полный JSON ответа
            </button>
            {showFullJson && (
              <pre className="mt-3 max-h-[min(420px,50vh)] overflow-auto rounded-2xl border border-[color:var(--ph-border)] bg-[color:var(--ph-pre-bg)] p-4 text-xs leading-relaxed text-[color:var(--ph-muted)] shadow-inner">
                {JSON.stringify(scanResult, null, 2)}
              </pre>
            )}
            {scanResult.raw_text && (
              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => setRawOpen((v) => !v)}
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-200/90 bg-slate-50/80 px-4 py-3.5 text-left text-sm font-medium text-slate-900 shadow-sm transition hover:bg-slate-100"
                >
                  <span className="flex items-center gap-2">
                    <FileText className="size-4 text-[color:var(--ph-accent)]" />
                    Сырой текст ответа модели
                  </span>
                  {rawOpen ? (
                    <ChevronUp className="size-4 text-[color:var(--ph-muted)]" />
                  ) : (
                    <ChevronDown className="size-4 text-[color:var(--ph-muted)]" />
                  )}
                </button>
                {rawOpen && (
                  <textarea
                    readOnly
                    value={scanResult.raw_text}
                    className="mt-2 min-h-[220px] w-full resize-y rounded-2xl border border-[color:var(--ph-border)] bg-[color:var(--ph-pre-bg)] px-4 py-3 font-mono text-xs leading-relaxed text-[color:var(--ph-muted)] shadow-inner"
                  />
                )}
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-8">
            <div className="mb-5 flex items-start gap-3">
              <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-slate-200/90">
                <FileText className="size-5 text-[color:var(--ph-accent)]" aria-hidden />
              </span>
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-[color:var(--ph-ink)]">
                  Договор
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-[color:var(--ph-muted)]">
                  Нужен успешный скан и тот же файл в сессии (пересканируйте при
                  сбое).
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={!file || !scanResult || buildingContract}
              onClick={handleBuildContract}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-800 shadow-sm transition hover:border-blue-300 hover:bg-blue-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {buildingContract ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <FileText className="size-4 text-[color:var(--ph-accent)]" aria-hidden />
              )}
              Сформировать договор (.docx) по данным паспорта
            </button>
            {contractBlob && downloadHref && (
              <a
                href={downloadHref}
                download={contractFilename ?? "dogovor.docx"}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-7 py-3.5 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                <FileDown className="size-4" aria-hidden />
                Скачать договор (.docx)
              </a>
            )}
          </section>
        </>
      )}
      </div>
    </div>
  );
}
