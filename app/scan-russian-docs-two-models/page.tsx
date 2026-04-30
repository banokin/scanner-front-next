"use client";

import { AlertCircle, FileDown, Loader2, Scan, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildContractFromUnifiedJson,
  scanDocumentsRussianDocsTwoModels,
  type UnifiedScanResponse,
} from "@/lib/api/passport";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"]);

type UploadKey = "passportMain" | "passportRegistration" | "egrnExtract";

const UPLOAD_SLOTS: Array<{ key: UploadKey; title: string; subtitle: string }> = [
  {
    key: "passportMain",
    title: "Паспорт, основной разворот",
    subtitle: "Сканирует RussianDocsOCR",
  },
  {
    key: "passportRegistration",
    title: "Паспорт, прописка",
    subtitle: "Сканируют Qwen + Llama Scout",
  },
  {
    key: "egrnExtract",
    title: "Выписка ЕГРН",
    subtitle: "Сканируют Qwen + Llama Scout",
  },
];

const isAllowedFile = (file: File): boolean =>
  ALLOWED_TYPES.has(file.type) || (file.type === "" && file.name.toLowerCase().endsWith(".pdf"));

function registrationAddress(result: UnifiedScanResponse | null): string {
  const registration = result?.data.passport_registration;
  if (!registration) return "";
  const parts = [
    registration.region,
    registration.city,
    registration.settlement,
    registration.street,
    registration.house ? `д. ${registration.house}` : "",
    registration.building ? `корп. ${registration.building}` : "",
    registration.apartment ? `кв. ${registration.apartment}` : "",
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean);
  return registration.address?.trim() || parts.join(", ");
}

function parseRawJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export default function ScanRussianDocsTwoModelsPage() {
  const [files, setFiles] = useState<Record<UploadKey, File | null>>({
    passportMain: null,
    passportRegistration: null,
    egrnExtract: null,
  });
  const [dragOverKey, setDragOverKey] = useState<UploadKey | null>(null);
  const [scanning, setScanning] = useState(false);
  const [buildingContract, setBuildingContract] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UnifiedScanResponse | null>(null);
  const [customerAddressOverride, setCustomerAddressOverride] = useState("");
  const [ownershipBasisDocumentOverride, setOwnershipBasisDocumentOverride] = useState("");
  const [customerEmailOverride, setCustomerEmailOverride] = useState("");
  const [customerPhoneOverride, setCustomerPhoneOverride] = useState("");
  const [contractBlob, setContractBlob] = useState<Blob | null>(null);
  const [contractFilename, setContractFilename] = useState<string | null>(null);
  const [downloadHref, setDownloadHref] = useState<string | null>(null);

  const allFilesSelected = Boolean(files.passportMain && files.passportRegistration && files.egrnExtract);
  const backendFilesDebug = useMemo(
    () => parseRawJson<Record<string, { filename: string; bytes: number; sha256_12: string }>>(
      result?.raw_text._files,
      {},
    ),
    [result?.raw_text._files],
  );

  useEffect(() => {
    if (!contractBlob) {
      setDownloadHref(null);
      return;
    }
    const url = URL.createObjectURL(contractBlob);
    setDownloadHref(url);
    return () => URL.revokeObjectURL(url);
  }, [contractBlob]);

  const resetResult = useCallback(() => {
    setResult(null);
    setCustomerAddressOverride("");
    setOwnershipBasisDocumentOverride("");
    setCustomerEmailOverride("");
    setCustomerPhoneOverride("");
    setContractBlob(null);
    setContractFilename(null);
    setError(null);
  }, []);

  const onFileChosen = useCallback(
    (key: UploadKey, selected: File | null) => {
      if (!selected) return;
      if (!isAllowedFile(selected)) {
        setError("Поддерживаются PNG, JPG, JPEG, WEBP и PDF.");
        return;
      }
      console.info("[scan-russian-docs-two-models-page] file:selected", {
        key,
        name: selected.name,
        size: selected.size,
        type: selected.type,
      });
      setFiles((prev) => ({ ...prev, [key]: selected }));
      resetResult();
    },
    [resetResult],
  );

  const handleScan = async () => {
    if (!files.passportMain || !files.passportRegistration || !files.egrnExtract) return;
    setScanning(true);
    setError(null);
    setContractBlob(null);
    setContractFilename(null);
    try {
      const payload = await scanDocumentsRussianDocsTwoModels({
        passportMain: files.passportMain,
        passportRegistration: files.passportRegistration,
        egrnExtract: files.egrnExtract,
      });
      setResult(payload);
      setCustomerAddressOverride(registrationAddress(payload));
      setOwnershipBasisDocumentOverride("");
      setCustomerEmailOverride("");
      setCustomerPhoneOverride("");
    } catch (e: unknown) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setScanning(false);
    }
  };

  const handleBuildContract = async () => {
    if (!result) return;
    setBuildingContract(true);
    setError(null);
    try {
      const contract = await buildContractFromUnifiedJson(
        result,
        customerAddressOverride,
        ownershipBasisDocumentOverride,
        customerEmailOverride,
        customerPhoneOverride,
      );
      setContractBlob(contract.blob);
      setContractFilename(contract.filename);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setBuildingContract(false);
    }
  };

  return (
    <div className="relative min-h-screen text-black">
      <div className="relative mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <section className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-9">
          <h1 className="mb-2 text-xl font-semibold tracking-tight text-black">
            RussianDocsOCR + two-models
          </h1>
          <p className="mb-6 text-sm text-slate-600">
            Основной разворот паспорта распознает RussianDocsOCR. Прописку и ЕГРН распознают две HF-модели:
            Qwen и Llama Scout.
          </p>

          <div className="space-y-5">
            {UPLOAD_SLOTS.map((slot) => {
              const inputId = `mixed-russian-docs-two-models-${slot.key}`;
              const slotFile = files[slot.key];
              const isDragOver = dragOverKey === slot.key;
              return (
                <div key={slot.key}>
                  <div className="mb-3 flex items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-slate-200/90">
                      <Upload className="size-4 text-blue-600" aria-hidden />
                    </span>
                    <div>
                      <label htmlFor={inputId} className="text-sm font-semibold text-black">
                        {slot.title}
                      </label>
                      <p className="text-xs text-slate-500">{slot.subtitle}</p>
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
                      "group relative cursor-pointer rounded-2xl border-2 border-dashed px-6 py-7 text-center transition-all duration-300",
                      isDragOver
                        ? "scale-[1.01] border-blue-500 bg-blue-50"
                        : "border-slate-300 hover:border-blue-300 hover:bg-slate-50",
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
                      <p className="text-xs text-slate-500">PNG, JPG, WEBP, PDF</p>
                      {slotFile && <p className="mt-1 max-w-full truncate font-medium text-blue-700">{slotFile.name}</p>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            disabled={!allFilesSelected || scanning}
            onClick={handleScan}
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-7 py-3.5 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {scanning ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Scan className="size-4" aria-hidden />}
            Сканировать mixed-методом
          </button>
        </section>

        {error && (
          <div className="mb-8 flex gap-3 rounded-2xl border border-red-200/80 bg-red-50/90 px-5 py-4 text-sm text-red-900">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden />
            <pre className="whitespace-pre-wrap font-sans">{error}</pre>
          </div>
        )}

        {result && (
          <>
            {Object.keys(backendFilesDebug).length > 0 && (
              <section className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-8">
                <h2 className="mb-3 text-lg font-semibold text-black">Файлы, полученные backend</h2>
                <div className="grid gap-2 text-xs text-slate-700 sm:grid-cols-3">
                  {Object.entries(backendFilesDebug).map(([key, meta]) => (
                    <div key={key} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="font-semibold text-slate-900">{key}</p>
                      <p className="truncate">{meta.filename}</p>
                      <p>{meta.bytes} bytes</p>
                      <p>sha: {meta.sha256_12}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-8">
              <h2 className="mb-4 text-lg font-semibold text-black">Данные для договора</h2>
              <div className="grid gap-4">
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-black">Адрес заказчика</span>
                  <textarea
                    value={customerAddressOverride}
                    onChange={(e) => setCustomerAddressOverride(e.target.value)}
                    className="min-h-[84px] w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-black">Основание собственности</span>
                  <textarea
                    value={ownershipBasisDocumentOverride}
                    onChange={(e) => setOwnershipBasisDocumentOverride(e.target.value)}
                    placeholder="Например: Выписка ЕГРН от 19.03.2025"
                    className="min-h-[84px] w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-sm font-semibold text-black">Email заказчика</span>
                    <input
                      type="email"
                      value={customerEmailOverride}
                      onChange={(e) => setCustomerEmailOverride(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-sm font-semibold text-black">Телефон заказчика</span>
                    <input
                      type="text"
                      value={customerPhoneOverride}
                      onChange={(e) => setCustomerPhoneOverride(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </label>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleBuildContract}
                  disabled={buildingContract}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {buildingContract ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
                  Создать договор (.docx)
                </button>
                {contractBlob && downloadHref && (
                  <a
                    href={downloadHref}
                    download={contractFilename ?? "dogovor.docx"}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-blue-300 hover:bg-blue-50/50"
                  >
                    <FileDown className="size-4" />
                    Скачать договор
                  </a>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-8">
              <h2 className="mb-2 text-lg font-semibold text-black">JSON ответа</h2>
              <p className="mb-4 text-xs text-slate-500">model: {result.model}</p>
              <pre className="max-h-[min(560px,60vh)] overflow-auto rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs leading-relaxed text-slate-100 shadow-inner">
                {JSON.stringify(result, null, 2)}
              </pre>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
