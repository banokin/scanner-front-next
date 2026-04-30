"use client";

import { AlertCircle, FileDown, Loader2, Scan, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildContractFromUnifiedJson,
  scanDocumentsRussianDocsOcr,
  type EgrnExtractData,
  type PassportData,
  type PassportRegistrationData,
  type UnifiedScanResponse,
} from "@/lib/api/passport";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"]);

type UploadKey = "passportMain" | "passportRegistration" | "egrnExtract";

const UPLOAD_SLOTS: Array<{ key: UploadKey; title: string; subtitle: string }> = [
  {
    key: "passportMain",
    title: "Паспорт, основной разворот",
    subtitle: "Фото страницы с ФИО, серией и номером",
  },
  {
    key: "passportRegistration",
    title: "Паспорт, прописка",
    subtitle: "Фото страницы регистрации",
  },
  {
    key: "egrnExtract",
    title: "Выписка ЕГРН",
    subtitle: "Фото или PDF выписки",
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

const EGRN_FIELDS: Array<{ key: keyof EgrnExtractData; label: string }> = [
  { key: "cadastral_number", label: "Кадастровый номер" },
  { key: "object_type", label: "Тип объекта" },
  { key: "address", label: "Адрес объекта" },
  { key: "area_sq_m", label: "Площадь, м2" },
  { key: "ownership_type", label: "Вид собственности" },
  { key: "extract_date", label: "Дата выписки" },
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

const FIO_FIELD_KEYS = new Set<keyof PassportData>(["surname", "name", "patronymic"]);

const isAllowedFile = (file: File): boolean =>
  ALLOWED_TYPES.has(file.type) || (file.type === "" && file.name.toLowerCase().endsWith(".pdf"));

function validateFioValue(label: string, value: string, patronymic = false): string[] {
  const text = String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!text) return [`${label} не распознано`];
  const warnings: string[] = [];
  if (!/^[А-ЯЁ][А-ЯЁ -]{1,64}$/.test(text)) {
    warnings.push("недопустимые символы или длина");
  }
  if (/[A-Z0-9]/.test(text)) {
    warnings.push("есть латиница или цифры");
  }
  if (/(.)\1\1/.test(text)) {
    warnings.push("три одинаковые буквы подряд");
  }
  if (/(ДЙ|ТЙ|НЙ|ЛЙ|РЙ|СЙ|ЗЙ|ВЙ|БЙ|ПЙ|ФЙ|ГЙ|КЙ|ХЙ|ЖЙ|ШЙ|ЩЙ|ЧЙ|ЦЙ|ЙМ|ЙН|ЙР|ЙЛ)/.test(text)) {
    warnings.push("подозрительное сочетание букв, проверьте OCR");
  }
  if (patronymic && !/(ОВИЧ|ЕВИЧ|ИЧ|ОВНА|ЕВНА|ИНИЧНА|ЫЧ|КЫЗЫ|ОГЛЫ)$/.test(text)) {
    warnings.push("нет типичного окончания отчества");
  }
  return warnings.map((warning) => `${label}: ${warning}`);
}

function validatePassportFio(data: PassportData | null): Partial<Record<keyof PassportData, string[]>> {
  if (!data) return {};
  return {
    surname: validateFioValue("Фамилия", data.surname),
    name: validateFioValue("Имя", data.name),
    patronymic: validateFioValue("Отчество", data.patronymic, true),
  };
}

function looksLikeIssuingAuthority(value: string): boolean {
  const text = String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!text) return false;
  const hasAuthorityWords = /(ОТДЕЛОМ|ОТДЕЛ\s+|УФМС|МВД|ГУВМ|ОВД|РОССИИ|ВЫДАН|КОД\s+ПОДРАЗД)/.test(text);
  const hasAddressWords = /(УЛ\.|УЛИЦА|Д\.|ДОМ|КВ\.|КВАРТИРА|ПР-КТ|ПРОСПЕКТ|ПЕР\.|ПЕРЕУЛОК|Ш\.|ШОССЕ)/.test(text);
  return hasAuthorityWords && !hasAddressWords;
}

function validateRegistrationAddress(data: PassportRegistrationData | null): Partial<Record<keyof PassportRegistrationData, string[]>> {
  if (!data) return {};
  const warnings: Partial<Record<keyof PassportRegistrationData, string[]>> = {};
  if (!data.address?.trim()) {
    warnings.address = ["Адрес регистрации не заполнен"];
  }
  for (const key of ["address", "region", "city", "settlement", "street"] as const) {
    if (looksLikeIssuingAuthority(data[key])) {
      warnings[key] = [
        ...(warnings[key] ?? []),
        "Похоже на орган выдачи паспорта, а не на адрес регистрации",
      ];
    }
  }
  return warnings;
}

function validateEgrnData(
  data: EgrnExtractData | null,
  passport: PassportData | null,
): Partial<Record<keyof EgrnExtractData, string[]>> {
  if (!data) return {};
  const warnings: Partial<Record<keyof EgrnExtractData, string[]>> = {};
  const hasCoreFields = Boolean(data.cadastral_number || data.address || data.right_holders?.length);
  if (!hasCoreFields) {
    warnings.address = ["Данные ЕГРН не распознаны, заполните вручную"];
    warnings.cadastral_number = ["Кадастровый номер не распознан"];
  }
  const passportDates = new Set([passport?.birth_date, passport?.issue_date].filter(Boolean));
  if (data.extract_date && passportDates.has(data.extract_date)) {
    warnings.extract_date = ["Похоже на дату из паспорта, а не на дату выписки ЕГРН"];
  }
  if (looksLikeIssuingAuthority(data.address)) {
    warnings.address = [
      ...(warnings.address ?? []),
      "Похоже на орган выдачи паспорта, а не на адрес объекта",
    ];
  }
  return warnings;
}

function sanitizeEgrnDataForUi(data: EgrnExtractData, passport: PassportData): EgrnExtractData {
  const passportDates = new Set([passport.birth_date, passport.issue_date].filter(Boolean));
  const hasCoreFields = Boolean(data.cadastral_number || data.address || data.right_holders?.length);
  if (!hasCoreFields && data.extract_date && passportDates.has(data.extract_date)) {
    return { ...data, extract_date: "" };
  }
  if (looksLikeIssuingAuthority(data.address)) {
    return { ...data, address: "" };
  }
  return data;
}

function buildRegistrationAddress(registration: UnifiedScanResponse["data"]["passport_registration"]): string {
  if (looksLikeIssuingAuthority(registration.address)) {
    return "";
  }
  const parts = [
    looksLikeIssuingAuthority(registration.region) ? "" : registration.region,
    looksLikeIssuingAuthority(registration.city) ? "" : registration.city,
    looksLikeIssuingAuthority(registration.settlement) ? "" : registration.settlement,
    looksLikeIssuingAuthority(registration.street) ? "" : registration.street,
    registration.house ? `д. ${registration.house}` : "",
    registration.building ? `корп. ${registration.building}` : "",
    registration.apartment ? `кв. ${registration.apartment}` : "",
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean);
  return registration.address?.trim() || parts.join(", ");
}

function findDuplicateFileWarnings(files: Record<UploadKey, File | null>): string[] {
  const entries = Object.entries(files).filter((entry): entry is [UploadKey, File] => Boolean(entry[1]));
  const warnings: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [leftKey, left] = entries[i];
      const [rightKey, right] = entries[j];
      const sameNameAndSize = left.name === right.name && left.size === right.size;
      const sameFileObject = left === right;
      if (sameFileObject || sameNameAndSize) {
        const leftTitle = UPLOAD_SLOTS.find((slot) => slot.key === leftKey)?.title ?? leftKey;
        const rightTitle = UPLOAD_SLOTS.find((slot) => slot.key === rightKey)?.title ?? rightKey;
        warnings.push(`${leftTitle} и ${rightTitle}: похоже выбран один и тот же файл`);
      }
    }
  }
  return warnings;
}

function parseRawJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export default function ScanRussianDocsOcrPage() {
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
      console.info("[scan-russian-docs-ocr-page] file:selected", {
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

  const allFilesSelected = Boolean(files.passportMain && files.passportRegistration && files.egrnExtract);
  const fioWarningsByField = useMemo(() => validatePassportFio(editablePassportData), [editablePassportData]);
  const fioWarnings = Object.values(fioWarningsByField).flat();
  const registrationWarningsByField = useMemo(
    () => validateRegistrationAddress(editableRegistrationData),
    [editableRegistrationData],
  );
  const registrationWarnings = Object.values(registrationWarningsByField).flat();
  const egrnWarningsByField = useMemo(
    () => validateEgrnData(editableEgrnData, editablePassportData),
    [editableEgrnData, editablePassportData],
  );
  const egrnWarnings = Object.values(egrnWarningsByField).flat();
  const duplicateFileWarnings = useMemo(() => findDuplicateFileWarnings(files), [files]);
  const backendFilesDebug = useMemo(
    () => parseRawJson<Record<string, { filename: string; bytes: number; sha256_12: string }>>(
      result?.raw_text._files,
      {},
    ),
    [result?.raw_text._files],
  );
  const backendFileWarnings = useMemo(
    () => parseRawJson<string[]>(result?.raw_text._warnings, []),
    [result?.raw_text._warnings],
  );

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

  useEffect(() => {
    if (!contractBlob) {
      setDownloadHref(null);
      return;
    }
    const url = URL.createObjectURL(contractBlob);
    setDownloadHref(url);
    return () => URL.revokeObjectURL(url);
  }, [contractBlob]);

  const handleScan = async () => {
    if (!files.passportMain || !files.passportRegistration || !files.egrnExtract) return;
    console.info("[scan-russian-docs-ocr-page] scan:start", { mode: "RussianDocsOCR:ONNX:cpu", docs: 3 });
    setScanning(true);
    setError(null);
    setContractBlob(null);
    setContractFilename(null);
    try {
      const payload = await scanDocumentsRussianDocsOcr({
        passportMain: files.passportMain,
        passportRegistration: files.passportRegistration,
        egrnExtract: files.egrnExtract,
      });
      console.info("[scan-russian-docs-ocr-page] scan:success", { model: payload.model });
      const passportData = { ...payload.data.passport_main };
      setResult(payload);
      setEditablePassportData(passportData);
      setEditableRegistrationData({ ...payload.data.passport_registration });
      setEditableEgrnData(sanitizeEgrnDataForUi({ ...payload.data.egrn_extract }, passportData));
      setCustomerAddressOverride(buildRegistrationAddress(payload.data.passport_registration));
      setOwnershipBasisDocumentOverride("");
      setCustomerEmailOverride("");
      setCustomerPhoneOverride("");
    } catch (e: unknown) {
      console.error("[scan-russian-docs-ocr-page] scan:failed", e);
      setResult(null);
      setEditablePassportData(null);
      setEditableRegistrationData(null);
      setEditableEgrnData(null);
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

  const handleEgrnFieldChange = (key: keyof EgrnExtractData, value: string) => {
    setEditableEgrnData((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleRegistrationFieldChange = (key: keyof PassportRegistrationData, value: string) => {
    setEditableRegistrationData((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      setCustomerAddressOverride(buildRegistrationAddress(next));
      return next;
    });
  };

  return (
    <div className="relative min-h-screen text-black">
      <div className="relative mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <section className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-9">
          <h1 className="mb-2 text-xl font-semibold tracking-tight text-black">Эксперимент: RussianDocsOCR</h1>
          <p className="mb-6 text-sm text-slate-600">
            Все 3 документа проходят через{" "}
            <a className="text-blue-600 underline" href="https://github.com/protei300/RussianDocsOCR" target="_blank">
              RussianDocsOCR
            </a>
            . Для договора ниже можно поправить распознанные поля вручную.
          </p>

          <div className="mb-5 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-950">
            Режим фиксирован: <span className="font-semibold">ONNX</span>, устройство{" "}
            <span className="font-semibold">cpu</span>.
          </div>
          {duplicateFileWarnings.length > 0 && (
            <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="font-semibold">Проверьте выбранные файлы</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {duplicateFileWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          {Object.keys(backendFilesDebug).length > 0 && (
            <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
              <p className="mb-2 text-sm font-semibold text-slate-900">Файлы, полученные backend</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {Object.entries(backendFilesDebug).map(([key, meta]) => (
                  <div key={key} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <p className="font-semibold text-slate-900">{key}</p>
                    <p className="truncate">{meta.filename}</p>
                    <p>{meta.bytes} bytes</p>
                    <p>sha: {meta.sha256_12}</p>
                  </div>
                ))}
              </div>
              {backendFileWarnings.length > 0 && (
                <p className="mt-2 text-amber-700">{backendFileWarnings.join("; ")}</p>
              )}
            </div>
          )}

          <div className="space-y-5">
            {UPLOAD_SLOTS.map((slot) => {
              const inputId = `russian-docs-ocr-${slot.key}`;
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
            Сканировать 3 документа
          </button>
        </section>

        {error && (
          <div className="mb-8 flex gap-3 rounded-2xl border border-red-200/80 bg-red-50/90 px-5 py-4 text-sm text-red-900">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden />
            <pre className="whitespace-pre-wrap font-sans">{error}</pre>
          </div>
        )}

        {editablePassportData && (
          <section className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-8">
            <h2 className="mb-1 text-lg font-semibold text-black">Данные паспорта для договора</h2>
            <p className="mb-6 text-sm text-slate-600">Проверьте распознанные поля и поправьте вручную.</p>
            {fioWarnings.length > 0 && (
              <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <p className="font-semibold">ФИО требует проверки</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {fioWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {PASSPORT_FIELDS.map((field) => {
                const fieldWarnings = FIO_FIELD_KEYS.has(field.key) ? fioWarningsByField[field.key] ?? [] : [];
                const hasWarning = fieldWarnings.length > 0;
                return (
                  <label
                    key={field.key}
                    className={[
                      "block rounded-2xl border bg-slate-50/60 px-4 py-3",
                      hasWarning ? "border-amber-300 ring-1 ring-amber-200" : "border-slate-200",
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
                        hasWarning
                          ? "border-amber-300 focus:border-amber-400 focus:ring-amber-200"
                          : "border-slate-300 focus:border-blue-400 focus:ring-blue-200",
                      ].join(" ")}
                    />
                    {hasWarning && <p className="mt-1.5 text-xs text-amber-700">{fieldWarnings.join("; ")}</p>}
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
              Если RussianDocsOCR распознал страницу прописки как другой документ, заполните адрес вручную.
            </p>
            {registrationWarnings.length > 0 && (
              <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <p className="font-semibold">Адрес прописки требует проверки</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {registrationWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {REGISTRATION_FIELDS.map((field) => {
                const fieldWarnings = registrationWarningsByField[field.key] ?? [];
                const hasWarning = fieldWarnings.length > 0;
                return (
                  <label
                    key={field.key}
                    className={[
                      "block rounded-2xl border bg-slate-50/60 px-4 py-3",
                      field.key === "address" ? "sm:col-span-2" : "",
                      hasWarning ? "border-amber-300 ring-1 ring-amber-200" : "border-slate-200",
                    ].join(" ")}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                      {field.label}
                    </span>
                    <input
                      type="text"
                      value={String(editableRegistrationData[field.key] ?? "")}
                      onChange={(e) => handleRegistrationFieldChange(field.key, e.target.value)}
                      className={[
                        "mt-1.5 w-full rounded-lg border bg-white px-2.5 py-2 text-sm font-medium text-black shadow-sm focus:outline-none focus:ring-2",
                        hasWarning
                          ? "border-amber-300 focus:border-amber-400 focus:ring-amber-200"
                          : "border-slate-300 focus:border-blue-400 focus:ring-blue-200",
                      ].join(" ")}
                    />
                    {hasWarning && <p className="mt-1.5 text-xs text-amber-700">{fieldWarnings.join("; ")}</p>}
                  </label>
                );
              })}
            </div>
          </section>
        )}

        {editableEgrnData && (
          <section className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-8">
            <h2 className="mb-1 text-lg font-semibold text-black">Данные ЕГРН для договора</h2>
            <p className="mb-6 text-sm text-slate-600">Если RussianDocsOCR не распознал ЕГРН, заполните поля вручную.</p>
            {egrnWarnings.length > 0 && (
              <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <p className="font-semibold">ЕГРН требует проверки</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {egrnWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {EGRN_FIELDS.map((field) => {
                const fieldWarnings = egrnWarningsByField[field.key] ?? [];
                const hasWarning = fieldWarnings.length > 0;
                return (
                  <label
                    key={field.key}
                    className={[
                      "block rounded-2xl border bg-slate-50/60 px-4 py-3",
                      hasWarning ? "border-amber-300 ring-1 ring-amber-200" : "border-slate-200",
                    ].join(" ")}
                  >
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
                      className={[
                        "mt-1.5 w-full rounded-lg border bg-white px-2.5 py-2 text-sm font-medium text-black shadow-sm focus:outline-none focus:ring-2",
                        hasWarning
                          ? "border-amber-300 focus:border-amber-400 focus:ring-amber-200"
                          : "border-slate-300 focus:border-blue-400 focus:ring-blue-200",
                      ].join(" ")}
                    />
                    {hasWarning && <p className="mt-1.5 text-xs text-amber-700">{fieldWarnings.join("; ")}</p>}
                  </label>
                );
              })}
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

        {preparedResult && (
          <>
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
              <p className="mb-4 text-xs text-slate-500">model: {preparedResult.model}</p>
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
