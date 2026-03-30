"use client";

import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileDown,
  FileText,
  Loader2,
  Scan,
  Sparkles,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const PASSPORT_HF_API_URL = `${API_BASE_URL}/scan-passport`;
const PASSPORT_TO_CONTRACT_HF_API_URL = `${API_BASE_URL}/scan-passport-to-contract-hf`;

const HF_SEC = Number(process.env.NEXT_PUBLIC_HF_REQUEST_TIMEOUT_SEC ?? 90);
/** Согласовано со Streamlit: connect + read */
const FETCH_TIMEOUT_MS = (10 + HF_SEC + 45) * 1000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

type PassportData = {
  issuing_authority: string;
  issue_date: string;
  department_code: string;
  passport_series: string;
  passport_number: string;
  surname: string;
  name: string;
  patronymic: string;
  gender: string;
  birth_date: string;
  birth_place: string;
  confidence_note: string;
};

type ScanResponse = {
  ok: boolean;
  model: string;
  data: PassportData;
  raw_text: string;
};

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

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

function formatApiDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}

export default function PassportHfPage() {
  const [file, setFile] = useState<File | null>(null);
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
    setContractBlob(null);
    setContractFilename(null);
    setError(null);
    setShowFullJson(false);
    setRawOpen(false);
  }, []);

  const onFileChosen = useCallback(
    (f: File | null) => {
      if (!f) return;
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
      if (f && f.type.startsWith("image/")) onFileChosen(f);
    },
    [onFileChosen],
  );

  const handleScan = async () => {
    if (!file) return;
    setError(null);
    setScanning(true);
    setContractBlob(null);
    setContractFilename(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetchWithTimeout(
        PASSPORT_HF_API_URL,
        { method: "POST", body: form },
        FETCH_TIMEOUT_MS,
      );
      if (response.ok) {
        const data = (await response.json()) as ScanResponse;
        setScanResult(data);
      } else {
        setScanResult(null);
        let msg = `Ошибка API: ${response.status}`;
        try {
          const errBody = (await response.json()) as { detail?: unknown };
          if (errBody.detail !== undefined) {
            msg += `\n${formatApiDetail(errBody.detail)}`;
          }
        } catch {
          msg += `\n${await response.text()}`;
        }
        setError(msg);
      }
    } catch (e: unknown) {
      setScanResult(null);
      if (e instanceof Error && e.name === "AbortError") {
        setError(
          `Превышено время ожидания (бэкенд HF ~${HF_SEC} с). Убедитесь, что uvicorn запущен; при перегрузке HF увеличьте HF_REQUEST_TIMEOUT_SEC.`,
        );
      } else if (e instanceof TypeError) {
        setError("Не удалось подключиться к FastAPI.");
      } else {
        setError(e instanceof Error ? e.message : "Неизвестная ошибка");
      }
    } finally {
      setScanning(false);
    }
  };

  const handleBuildContract = async () => {
    if (!file || !scanResult) return;
    setError(null);
    setBuildingContract(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetchWithTimeout(
        PASSPORT_TO_CONTRACT_HF_API_URL,
        { method: "POST", body: form },
        FETCH_TIMEOUT_MS,
      );
      if (!response.ok) {
        let msg = `Ошибка API: ${response.status}`;
        try {
          const errBody = (await response.json()) as { detail?: unknown };
          if (errBody.detail !== undefined) {
            msg += `\n${formatApiDetail(errBody.detail)}`;
          }
        } catch {
          msg += `\n${await response.text()}`;
        }
        setError(msg);
        return;
      }
      const payload = (await response.json()) as {
        download_url?: string;
        generated_filename?: string;
      };
      const downloadUrl = payload.download_url;
      if (!downloadUrl) {
        setError("API не вернул ссылку для скачивания договора.");
        return;
      }
      const fileResponse = await fetchWithTimeout(
        `${API_BASE_URL}${downloadUrl}`,
        { method: "GET" },
        DOWNLOAD_TIMEOUT_MS,
      );
      if (!fileResponse.ok) {
        setError(`Ошибка скачивания файла: ${fileResponse.status}`);
        return;
      }
      const blob = await fileResponse.blob();
      setContractBlob(blob);
      setContractFilename(
        payload.generated_filename ?? downloadUrl.split("/").pop() ?? "dogovor.docx",
      );
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        setError(
          `Превышено время ожидания (HF ~${HF_SEC} с). Повторите или увеличьте HF_REQUEST_TIMEOUT_SEC.`,
        );
      } else if (e instanceof TypeError) {
        setError("Не удалось подключиться к FastAPI.");
      } else {
        setError(e instanceof Error ? e.message : "Неизвестная ошибка");
      }
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
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-10 text-center sm:mb-14">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[color:var(--ph-border)] bg-[color:var(--ph-card)] px-3 py-1 text-xs font-medium tracking-wide text-[color:var(--ph-muted)]">
          <Sparkles className="size-3.5 text-[color:var(--ph-accent)]" aria-hidden />
          Hugging Face · Vision
        </div>
        <h1 className="text-balance font-semibold tracking-tight text-[color:var(--ph-ink)] text-3xl sm:text-4xl">
          Скан паспорта
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-[color:var(--ph-muted)] sm:text-base">
          Извлечение структурированных полей через модель Hugging Face. Ожидание
          ответа HF — до ~{HF_SEC} с (настройка{" "}
          <code className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-[color:var(--ph-accent)]">
            HF_REQUEST_TIMEOUT_SEC
          </code>
          ).
        </p>
      </header>

      <section className="mb-8 rounded-2xl border border-[color:var(--ph-border)] bg-[color:var(--ph-card)] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] backdrop-blur-md sm:p-8">
        <label className="mb-3 flex items-center gap-2 text-sm font-medium text-[color:var(--ph-ink)]">
          <Upload className="size-4 text-[color:var(--ph-accent)]" aria-hidden />
          Загрузите фото паспорта
        </label>
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
            "group relative cursor-pointer rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
            dragOver
              ? "border-[color:var(--ph-accent)] bg-[color:var(--ph-glow)]"
              : "border-white/15 hover:border-white/25 hover:bg-white/[0.02]",
          ].join(" ")}
        >
          <input
            id="passport-file-input"
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            className="sr-only"
            onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
          />
          <div className="pointer-events-none flex flex-col items-center gap-2">
            <div className="flex size-12 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10 transition group-hover:ring-[color:var(--ph-accent-dim)]">
              <Upload className="size-5 text-[color:var(--ph-muted)]" />
            </div>
            <p className="text-sm text-[color:var(--ph-muted)]">
              Перетащите файл сюда или нажмите для выбора
            </p>
            <p className="text-xs text-white/35">PNG, JPG, JPEG, WEBP</p>
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
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#c9943c] to-[#e8b86a] px-6 py-3 text-sm font-semibold text-[#1a1206] shadow-lg shadow-black/25 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {scanning ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Scan className="size-4" aria-hidden />
            )}
            Сканировать (Hugging Face)
          </button>
          {scanning && (
            <p className="flex items-center gap-2 text-sm text-[color:var(--ph-muted)]">
              <Loader2 className="size-4 shrink-0 animate-spin text-[color:var(--ph-accent)]" />
              Сканирую паспорт через Hugging Face…
            </p>
          )}
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="mb-8 flex gap-3 rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-100"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-400" aria-hidden />
          <pre className="whitespace-pre-wrap font-sans">{error}</pre>
        </div>
      )}

      {scanResult && (
        <>
          <section className="mb-8">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight text-[color:var(--ph-ink)]">
                Данные паспорта
              </h2>
              <span className="text-xs text-[color:var(--ph-muted)]">
                Модель:{" "}
                <code className="rounded bg-white/5 px-1.5 py-0.5 text-[color:var(--ph-accent)]">
                  {scanResult.model}
                </code>
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {dataEntries.map(({ key, label, value }) => (
                <div
                  key={key}
                  className="rounded-xl border border-[color:var(--ph-border)] bg-[color:var(--ph-card)] px-4 py-3"
                >
                  <div className="text-xs font-medium uppercase tracking-wide text-[color:var(--ph-muted)]">
                    {label}
                  </div>
                  <div className="mt-1 break-words text-sm text-[color:var(--ph-ink)]">
                    {value || "—"}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowFullJson((v) => !v)}
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[color:var(--ph-accent)] hover:underline"
            >
              {showFullJson ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
              Показать полный JSON ответа API
            </button>
            {showFullJson && (
              <pre className="mt-3 max-h-[min(420px,50vh)] overflow-auto rounded-xl border border-[color:var(--ph-border)] bg-black/30 p-4 text-xs leading-relaxed text-[color:var(--ph-muted)]">
                {JSON.stringify(scanResult, null, 2)}
              </pre>
            )}
            {scanResult.raw_text && (
              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => setRawOpen((v) => !v)}
                  className="flex w-full items-center justify-between rounded-xl border border-[color:var(--ph-border)] bg-[color:var(--ph-card)] px-4 py-3 text-left text-sm font-medium text-[color:var(--ph-ink)] transition hover:bg-white/[0.06]"
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
                    className="mt-2 min-h-[220px] w-full resize-y rounded-xl border border-[color:var(--ph-border)] bg-black/25 px-4 py-3 font-mono text-xs leading-relaxed text-[color:var(--ph-muted)]"
                  />
                )}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[color:var(--ph-border)] bg-[color:var(--ph-card)] p-6 sm:p-8">
            <h2 className="mb-2 text-lg font-semibold tracking-tight text-[color:var(--ph-ink)]">
              Договор
            </h2>
            <p className="mb-6 text-sm text-[color:var(--ph-muted)]">
              Нужен успешный скан и тот же файл в сессии (пересканируйте при сбое).
            </p>
            <button
              type="button"
              disabled={!file || !scanResult || buildingContract}
              onClick={handleBuildContract}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-[color:var(--ph-ink)] transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
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
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#c9943c] to-[#e8b86a] px-6 py-3 text-sm font-semibold text-[#1a1206] shadow-lg shadow-black/25 transition hover:brightness-105"
              >
                <FileDown className="size-4" aria-hidden />
                Скачать договор (.docx)
              </a>
            )}
          </section>
        </>
      )}

      <footer className="mt-14 border-t border-white/10 pt-8 text-center text-xs text-white/35">
        API:{" "}
        <code className="rounded bg-white/5 px-1">{API_BASE_URL}</code>
      </footer>
    </div>
  );
}
