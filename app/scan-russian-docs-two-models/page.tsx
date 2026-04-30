"use client";

import { AlertCircle, FileDown, Loader2, Scan, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildContractFromUnifiedJson,
  scanDocumentsRussianDocsTwoModels,
  type EgrnExtractData,
  type PassportData,
  type PassportRegistrationData,
  type UnifiedScanResponse,
} from "@/lib/api/passport";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"]);

type UploadKey = "passportMain" | "passportRegistration" | "egrnExtract";

type AiValidationResult = {
  model?: string;
  warnings?: Array<{
    field?: keyof PassportData | "ai_validation" | string;
    current?: string;
    issue?: string;
    suggestion?: string;
  }>;
  corrected_fields?: Partial<Record<keyof PassportData, string>>;
};

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

const PASSPORT_FIELDS: Array<{ key: keyof PassportData; label: string; placeholder?: string }> = [
  { key: "surname", label: "Фамилия" },
  { key: "name", label: "Имя" },
  { key: "patronymic", label: "Отчество" },
  { key: "passport_series", label: "Серия паспорта", placeholder: "1234" },
  { key: "passport_number", label: "Номер паспорта", placeholder: "567890" },
  { key: "issuing_authority", label: "Кем выдан" },
  { key: "issue_date", label: "Дата выдачи", placeholder: "дд.мм.гггг" },
  { key: "department_code", label: "Код подразделения", placeholder: "123-456" },
  { key: "birth_date", label: "Дата рождения", placeholder: "дд.мм.гггг" },
  { key: "birth_place", label: "Место рождения" },
  { key: "gender", label: "Пол" },
];

const REGISTRATION_FIELDS: Array<{ key: keyof PassportRegistrationData; label: string }> = [
  { key: "address", label: "Адрес регистрации полностью" },
  { key: "region", label: "Регион" },
  { key: "city", label: "Город" },
  { key: "settlement", label: "Населенный пункт" },
  { key: "street", label: "Улица" },
  { key: "house", label: "Дом" },
  { key: "building", label: "Корпус/строение" },
  { key: "apartment", label: "Квартира" },
  { key: "registration_date", label: "Дата регистрации" },
];

const EGRN_FIELDS: Array<{ key: keyof EgrnExtractData; label: string }> = [
  { key: "cadastral_number", label: "Кадастровый номер" },
  { key: "object_type", label: "Тип объекта" },
  { key: "address", label: "Адрес объекта" },
  { key: "area_sq_m", label: "Площадь, м2" },
  { key: "ownership_type", label: "Вид собственности" },
  { key: "extract_date", label: "Дата выписки" },
];

const isAllowedFile = (file: File): boolean =>
  ALLOWED_TYPES.has(file.type) || (file.type === "" && file.name.toLowerCase().endsWith(".pdf"));

function registrationAddress(registration: PassportRegistrationData | null): string {
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
  const [editablePassportData, setEditablePassportData] = useState<PassportData | null>(null);
  const [editableRegistrationData, setEditableRegistrationData] = useState<PassportRegistrationData | null>(null);
  const [editableEgrnData, setEditableEgrnData] = useState<EgrnExtractData | null>(null);
  const [customerAddressOverride, setCustomerAddressOverride] = useState("");
  const [ownershipBasisDocumentOverride, setOwnershipBasisDocumentOverride] = useState("");
  const [customerEmailOverride, setCustomerEmailOverride] = useState("");
  const [customerPhoneOverride, setCustomerPhoneOverride] = useState("");
  const [contractBlob, setContractBlob] = useState<Blob | null>(null);
  const [contractFilename, setContractFilename] = useState<string | null>(null);
  const [downloadHref, setDownloadHref] = useState<string | null>(null);

  const allFilesSelected = Boolean(files.passportMain && files.passportRegistration && files.egrnExtract);
  const preparedResult = useMemo<UnifiedScanResponse | null>(() => {
    if (!result) return null;
    return {
      ...result,
      data: {
        ...result.data,
        passport_main: editablePassportData ?? result.data.passport_main,
        passport_registration: editableRegistrationData ?? result.data.passport_registration,
        egrn_extract: editableEgrnData ?? result.data.egrn_extract,
      },
    };
  }, [editableEgrnData, editablePassportData, editableRegistrationData, result]);
  const backendFilesDebug = useMemo(
    () => parseRawJson<Record<string, { filename: string; bytes: number; sha256_12: string }>>(
      result?.raw_text._files,
      {},
    ),
    [result?.raw_text._files],
  );
  const aiValidation = useMemo(
    () => parseRawJson<AiValidationResult | null>(result?.raw_text._ai_validation, null),
    [result?.raw_text._ai_validation],
  );
  const aiCorrections = aiValidation?.corrected_fields ?? {};
  const aiWarnings = aiValidation?.warnings ?? [];

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
    setEditablePassportData(null);
    setEditableRegistrationData(null);
    setEditableEgrnData(null);
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
      setEditablePassportData({ ...payload.data.passport_main });
      setEditableRegistrationData({ ...payload.data.passport_registration });
      setEditableEgrnData({ ...payload.data.egrn_extract });
      setCustomerAddressOverride(registrationAddress(payload.data.passport_registration));
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
    if (!preparedResult) return;
    setBuildingContract(true);
    setError(null);
    try {
      const contract = await buildContractFromUnifiedJson(
        preparedResult,
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

  const handlePassportFieldChange = (key: keyof PassportData, value: string) => {
    setEditablePassportData((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleRegistrationFieldChange = (key: keyof PassportRegistrationData, value: string) => {
    setEditableRegistrationData((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      setCustomerAddressOverride(registrationAddress(next));
      return next;
    });
  };

  const handleEgrnFieldChange = (key: keyof EgrnExtractData, value: string) => {
    setEditableEgrnData((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const applyAiPassportCorrections = () => {
    setEditablePassportData((prev) => (prev ? { ...prev, ...aiCorrections } : prev));
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

            {editablePassportData && (
              <section className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-8">
                <h2 className="mb-1 text-lg font-semibold text-black">Данные паспорта для договора</h2>
                <p className="mb-6 text-sm text-slate-600">
                  Основной разворот распознан через RussianDocsOCR. Проверьте поля перед созданием договора.
                </p>
                {aiWarnings.length > 0 && (
                  <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">AI-валидация слов паспорта</p>
                        <p className="mt-1 text-xs text-amber-800">model: {aiValidation?.model ?? "unknown"}</p>
                      </div>
                      {Object.keys(aiCorrections).length > 0 && (
                        <button
                          type="button"
                          onClick={applyAiPassportCorrections}
                          className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-700"
                        >
                          Применить AI-исправления
                        </button>
                      )}
                    </div>
                    <ul className="mt-3 space-y-2">
                      {aiWarnings.map((warning, index) => (
                        <li key={`${warning.field ?? "field"}-${index}`} className="rounded-xl bg-white/70 px-3 py-2">
                          <p className="font-semibold">{warning.field ?? "Поле"}</p>
                          <p>{warning.issue}</p>
                          {warning.current && <p className="text-xs text-amber-800">Сейчас: {warning.current}</p>}
                          {warning.suggestion && (
                            <p className="text-xs text-emerald-800">Предложение: {warning.suggestion}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  {PASSPORT_FIELDS.map((field) => {
                    const aiSuggestion = aiCorrections[field.key];
                    const hasSuggestion = Boolean(aiSuggestion && aiSuggestion !== editablePassportData[field.key]);
                    return (
                      <label
                        key={field.key}
                        className={[
                          "block rounded-2xl border bg-slate-50/60 px-4 py-3",
                          hasSuggestion ? "border-amber-300 ring-1 ring-amber-200" : "border-slate-200",
                        ].join(" ")}
                      >
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                          {field.label}
                        </span>
                        <input
                          type="text"
                          value={String(editablePassportData[field.key] ?? "")}
                          placeholder={field.placeholder}
                          onChange={(e) => handlePassportFieldChange(field.key, e.target.value)}
                          className={[
                            "mt-1.5 w-full rounded-lg border bg-white px-2.5 py-2 text-sm font-medium text-black shadow-sm focus:outline-none focus:ring-2",
                            hasSuggestion
                              ? "border-amber-300 focus:border-amber-400 focus:ring-amber-200"
                              : "border-slate-300 focus:border-blue-400 focus:ring-blue-200",
                          ].join(" ")}
                        />
                        {hasSuggestion && (
                          <button
                            type="button"
                            onClick={() => handlePassportFieldChange(field.key, String(aiSuggestion))}
                            className="mt-2 text-xs font-semibold text-amber-700 underline"
                          >
                            Применить: {aiSuggestion}
                          </button>
                        )}
                      </label>
                    );
                  })}
                </div>
              </section>
            )}

            {editableRegistrationData && (
              <section className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-8">
                <h2 className="mb-1 text-lg font-semibold text-black">Данные прописки для договора</h2>
                <p className="mb-6 text-sm text-slate-600">
                  Страница прописки распознана двумя моделями. При необходимости поправьте адрес вручную.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {REGISTRATION_FIELDS.map((field) => (
                    <label
                      key={field.key}
                      className={[
                        "block rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3",
                        field.key === "address" ? "sm:col-span-2" : "",
                      ].join(" ")}
                    >
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                        {field.label}
                      </span>
                      <input
                        type="text"
                        value={String(editableRegistrationData[field.key] ?? "")}
                        onChange={(e) => handleRegistrationFieldChange(field.key, e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-medium text-black shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </label>
                  ))}
                </div>
              </section>
            )}

            {editableEgrnData && (
              <section className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-8">
                <h2 className="mb-1 text-lg font-semibold text-black">Данные ЕГРН для договора</h2>
                <p className="mb-6 text-sm text-slate-600">
                  ЕГРН распознан двумя моделями. Заполните пустые поля, если модель не уверена.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {EGRN_FIELDS.map((field) => (
                    <label key={field.key} className="block rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                        {field.label}
                      </span>
                      <input
                        type="text"
                        value={
                          Array.isArray(editableEgrnData[field.key])
                            ? (editableEgrnData[field.key] as string[]).join(", ")
                            : String(editableEgrnData[field.key] ?? "")
                        }
                        onChange={(e) => handleEgrnFieldChange(field.key, e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-medium text-black shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </label>
                  ))}
                  <label className="block rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 sm:col-span-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                      Правообладатели
                    </span>
                    <input
                      type="text"
                      value={(editableEgrnData.right_holders ?? []).join(", ")}
                      onChange={(e) =>
                        setEditableEgrnData((prev) =>
                          prev
                            ? {
                                ...prev,
                                right_holders: e.target.value.split(",").map((v) => v.trim()).filter(Boolean),
                              }
                            : prev,
                        )
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-medium text-black shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </label>
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
              <p className="mb-4 text-xs text-slate-500">model: {preparedResult?.model}</p>
              <pre className="max-h-[min(560px,60vh)] overflow-auto rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs leading-relaxed text-slate-100 shadow-inner">
                {JSON.stringify(preparedResult, null, 2)}
              </pre>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
