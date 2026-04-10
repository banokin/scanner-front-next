"use client";

import { AlertCircle, ChevronDown, ChevronUp, FileDown, Loader2, Scan, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildContractFromUnifiedJson,
  scanDocumentsUnified,
  type EgrnExtractData,
  type PassportData,
  type UnifiedScanResponse,
} from "@/lib/api/passport";
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const ALLOWED_DOC_MIME_TYPES = new Set([...ALLOWED_IMAGE_MIME_TYPES, "application/pdf"]);

type UploadKey = "passportMain" | "passportRegistration" | "egrnExtract";

type UploadSlot = {
  key: UploadKey;
  title: string;
  subtitle: string;
  apiField: "passport_main" | "passport_registration" | "egrn_extract";
};

const UPLOAD_SLOTS: UploadSlot[] = [
  {
    key: "passportMain",
    title: "Фото паспорта (основной разворот)",
    subtitle: "Фото или PDF разворота с фото и персональными данными",
    apiField: "passport_main",
  },
  {
    key: "passportRegistration",
    title: "Фото страницы с пропиской",
    subtitle: "Фото или PDF страницы паспорта с адресом регистрации",
    apiField: "passport_registration",
  },
  {
    key: "egrnExtract",
    title: "Фото выписки ЕГРН",
    subtitle: "Фото или PDF выписки с реквизитами (PDF поддерживается)",
    apiField: "egrn_extract",
  },
];

const PASSPORT_MAIN_LABELS = {
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
};

const REGISTRATION_LABELS = {
  region: "Регион",
  city: "Город",
  settlement: "Населенный пункт",
  street: "Улица",
  house: "Дом",
  building: "Корпус/строение",
  apartment: "Квартира",
  registration_date: "Дата регистрации",
};

const EGRN_LABELS = {
  cadastral_number: "Кадастровый номер",
  object_type: "Тип объекта",
  address: "Адрес объекта",
  area_sq_m: "Площадь, м2",
  extract_date: "Дата выписки",
};

function buildRegistrationAddress(registration: UnifiedScanResponse["data"]["passport_registration"]): string {
  const parts: string[] = [];
  const pushIf = (v?: string) => {
    const value = String(v ?? "").trim();
    if (value) parts.push(value);
  };
  pushIf(registration.region);
  pushIf(registration.city);
  pushIf(registration.settlement);
  pushIf(registration.street);
  if (registration.house?.trim()) parts.push(`д. ${registration.house.trim()}`);
  if (registration.building?.trim()) parts.push(`корп. ${registration.building.trim()}`);
  if (registration.apartment?.trim()) parts.push(`кв. ${registration.apartment.trim()}`);
  return parts.join(", ");
}

export default function PassportHfPage() {
  const [files, setFiles] = useState<Record<UploadKey, File | null>>({
    passportMain: null,
    passportRegistration: null,
    egrnExtract: null,
  });
  const [dragOverKey, setDragOverKey] = useState<UploadKey | null>(null);
  const [scanResult, setScanResult] = useState<UnifiedScanResponse | null>(null);
  const [scanning, setScanning] = useState(false);
  const [buildingContract, setBuildingContract] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFullJson, setShowFullJson] = useState(false);
  const [contractBlob, setContractBlob] = useState<Blob | null>(null);
  const [contractFilename, setContractFilename] = useState<string | null>(null);
  const [downloadHref, setDownloadHref] = useState<string | null>(null);
  const [customerAddressOverride, setCustomerAddressOverride] = useState("");
  const [ownershipBasisDocumentOverride, setOwnershipBasisDocumentOverride] = useState("");
  const [customerEmailOverride, setCustomerEmailOverride] = useState("");
  const [customerPhoneOverride, setCustomerPhoneOverride] = useState("");
  const [editablePassportData, setEditablePassportData] = useState<PassportData | null>(null);
  const [editableEgrnData, setEditableEgrnData] = useState<EgrnExtractData | null>(null);
  const [rawOpenByKey, setRawOpenByKey] = useState<Record<UploadKey, boolean>>({
    passportMain: false,
    passportRegistration: false,
    egrnExtract: false,
  });

  const resetForNewFiles = useCallback(() => {
    setScanResult(null);
    setError(null);
    setShowFullJson(false);
    setContractBlob(null);
    setContractFilename(null);
    setDownloadHref(null);
    setCustomerAddressOverride("");
    setOwnershipBasisDocumentOverride("");
    setCustomerEmailOverride("");
    setCustomerPhoneOverride("");
    setEditablePassportData(null);
    setEditableEgrnData(null);
    setRawOpenByKey({
      passportMain: false,
      passportRegistration: false,
      egrnExtract: false,
    });
  }, []);

  const isPdfByExtension = (filename: string): boolean =>
    filename.trim().toLowerCase().endsWith(".pdf");

  const onFileChosen = useCallback(
    (key: UploadKey, f: File | null) => {
      if (!f) return;
      const isAllowed =
        ALLOWED_DOC_MIME_TYPES.has(f.type) ||
        (f.type === "" && isPdfByExtension(f.name));
      if (!isAllowed) {
        setError(
          "Поддерживаются PNG, JPG, JPEG, WEBP и PDF.",
        );
        return;
      }
      setFiles((prev) => ({ ...prev, [key]: f }));
      resetForNewFiles();
    },
    [resetForNewFiles],
  );

  const handleDrop = useCallback(
    (key: UploadKey, e: React.DragEvent) => {
      e.preventDefault();
      setDragOverKey(null);
      const f = e.dataTransfer.files[0];
      if (f) onFileChosen(key, f);
    },
    [onFileChosen],
  );

  const handleScan = async () => {
    const passportMain = files.passportMain;
    const passportRegistration = files.passportRegistration;
    const egrnExtract = files.egrnExtract;
    if (!passportMain || !passportRegistration || !egrnExtract) return;

    setError(null);
    setScanning(true);
    try {
      const data = await scanDocumentsUnified({
        passportMain,
        passportRegistration,
        egrnExtract,
      });
      setScanResult(data);
      setCustomerAddressOverride(buildRegistrationAddress(data.data.passport_registration));
      setOwnershipBasisDocumentOverride("");
      setCustomerEmailOverride("");
      setCustomerPhoneOverride("");
      setEditablePassportData({ ...data.data.passport_main });
      setEditableEgrnData({ ...data.data.egrn_extract });
      setContractBlob(null);
      setContractFilename(null);
    } catch (e: unknown) {
      setScanResult(null);
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setScanning(false);
    }
  };

  const handleBuildContract = async () => {
    if (!scanResult) return;
    setError(null);
    setBuildingContract(true);
    try {
      const preparedScanResult: UnifiedScanResponse = {
        ...scanResult,
        data: {
          ...scanResult.data,
          passport_main: editablePassportData ?? scanResult.data.passport_main,
          egrn_extract: editableEgrnData ?? scanResult.data.egrn_extract,
        },
      };
      const result = await buildContractFromUnifiedJson(
        preparedScanResult,
        customerAddressOverride,
        ownershipBasisDocumentOverride,
        customerEmailOverride,
        customerPhoneOverride,
      );
      setContractBlob(result.blob);
      setContractFilename(result.filename);
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

  const allFilesSelected = Boolean(
    files.passportMain && files.passportRegistration && files.egrnExtract,
  );

  const passportEntries = useMemo(() => {
    if (!editablePassportData) return [];
    return (Object.keys(PASSPORT_MAIN_LABELS) as Array<keyof typeof PASSPORT_MAIN_LABELS>).map(
      (key) => ({
        key,
        label: PASSPORT_MAIN_LABELS[key],
        value: editablePassportData[key as keyof PassportData],
      }),
    );
  }, [editablePassportData]);

  const registrationEntries = useMemo(() => {
    if (!scanResult?.data?.passport_registration) return [];
    return (Object.keys(REGISTRATION_LABELS) as Array<keyof typeof REGISTRATION_LABELS>).map(
      (key) => ({
        key,
        label: REGISTRATION_LABELS[key],
        value:
          scanResult.data.passport_registration[
            key as keyof typeof scanResult.data.passport_registration
          ],
      }),
    );
  }, [scanResult]);

  const egrnEntries = useMemo(() => {
    if (!editableEgrnData) return [];
    return (Object.keys(EGRN_LABELS) as Array<keyof typeof EGRN_LABELS>).map((key) => ({
      key,
      label: EGRN_LABELS[key],
      value: editableEgrnData[key as keyof EgrnExtractData],
    }));
  }, [editableEgrnData]);

  return (
    <div className="relative min-h-screen text-black">
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
          <h1 className="mb-6 text-xl font-semibold tracking-tight text-black">
            Сканирование 3 документов 
          </h1>

          <div className="space-y-5">
            {UPLOAD_SLOTS.map((slot) => {
              const inputId = `${slot.key}-input`;
              const slotFile = files[slot.key];
              const isDragOver = dragOverKey === slot.key;
              return (
                <div key={slot.key}>
                  <div className="mb-3 flex items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-slate-200/90">
                      <Upload className="size-4 text-[color:var(--ph-accent)]" aria-hidden />
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
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        document.getElementById(inputId)?.click();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverKey(slot.key);
                    }}
                    onDragLeave={() => setDragOverKey(null)}
                    onDrop={(e) => handleDrop(slot.key, e)}
                    onClick={() => document.getElementById(inputId)?.click()}
                    className={[
                      "group relative cursor-pointer rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-all duration-300",
                      isDragOver
                        ? "scale-[1.01] border-[color:var(--ph-accent)] bg-[color:var(--ph-glow)] shadow-[0_0_0_4px_rgba(37,99,235,0.18)]"
                        : "border-[color:var(--ph-drop-border)] hover:border-[color:var(--ph-drop-border-hover)] hover:bg-[color:var(--ph-surface)]",
                    ].join(" ")}
                  >
                    <input
                      id={inputId}
                      type="file"
                      accept={
                        "image/png,image/jpeg,image/jpg,image/webp,application/pdf,.pdf"
                      }
                      className="sr-only"
                      onChange={(e) => onFileChosen(slot.key, e.target.files?.[0] ?? null)}
                    />
                    <div className="pointer-events-none flex flex-col items-center gap-2">
                      <p className="text-sm text-black">
                        Перетащите файл или нажмите для выбора
                      </p>
                      <p className="text-xs text-black">
                        {slot.key === "egrnExtract"
                          ? "PNG, JPG, JPEG, WEBP, PDF"
                          : "PNG, JPG, JPEG, WEBP, PDF"}
                      </p>
                      {slotFile && (
                        <p className="mt-1 max-w-full truncate font-medium text-[color:var(--ph-accent)]">
                          {slotFile.name}
                          <span className="ml-2 font-normal text-black">
                            ({(slotFile.size / 1024).toFixed(1)} KB)
                          </span>
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
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-7 py-3.5 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {scanning ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Scan className="size-4" aria-hidden />
              )}
              Сканировать 3 документа
            </button>
            {scanning && (
              <p className="flex items-center gap-2 text-sm text-black">
                <Loader2 className="size-4 shrink-0 animate-spin text-[color:var(--ph-accent)]" />
                Сканирую документы...
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
                <h2 className="text-xl font-semibold tracking-tight text-black">
                  Итоговый JSON по 3 документам
                </h2>
              </div>

              

              <div className="mb-5">
                <label
                  htmlFor="customer-address-override"
                  className="mb-1 block text-sm font-semibold text-black"
                >
                  Адрес заказчика (можно исправить вручную)
                </label>
                <textarea
                  id="customer-address-override"
                  value={customerAddressOverride}
                  onChange={(e) => setCustomerAddressOverride(e.target.value)}
                  placeholder="Введите корректный адрес заказчика"
                  className="min-h-[84px] w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>

              <div className="mb-5">
                <label
                  htmlFor="ownership-basis-document-override"
                  className="mb-1 block text-sm font-semibold text-black"
                >
                  Основание собственности (вручную для договора)
                </label>
                <textarea
                  id="ownership-basis-document-override"
                  value={ownershipBasisDocumentOverride}
                  onChange={(e) => setOwnershipBasisDocumentOverride(e.target.value)}
                  placeholder="Например: Выписка ЕГРН от 19.03.2025"
                  className="min-h-[84px] w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>

              <div className="mb-5">
                <label htmlFor="customer-email-override" className="mb-1 block text-sm font-semibold text-black">
                  Email заказчика (для договора)
                </label>
                <input
                  id="customer-email-override"
                  type="email"
                  value={customerEmailOverride}
                  onChange={(e) => setCustomerEmailOverride(e.target.value)}
                  placeholder="example@mail.ru"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>

              <div className="mb-5">
                <label htmlFor="customer-phone-override" className="mb-1 block text-sm font-semibold text-black">
                  Телефон заказчика (для договора)
                </label>
                <input
                  id="customer-phone-override"
                  type="text"
                  value={customerPhoneOverride}
                  onChange={(e) => setCustomerPhoneOverride(e.target.value)}
                  placeholder="+7 (___) ___-__-__"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>

              <button
                type="button"
                onClick={() => setShowFullJson((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm font-medium text-blue-600 transition hover:bg-slate-100"
              >
                {showFullJson ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                Показать полный JSON ответа
              </button>
              {showFullJson && (
                <pre className="mt-3 max-h-[min(420px,50vh)] overflow-auto rounded-2xl border border-[color:var(--ph-border)] bg-[color:var(--ph-pre-bg)] p-4 text-xs leading-relaxed text-[color:var(--ph-muted)] shadow-inner">
                  {JSON.stringify(scanResult, null, 2)}
                </pre>
              )}
            </section>

            {[
              { key: "passportMain" as const, title: "Паспорт (основная страница)", entries: passportEntries },
              {
                key: "passportRegistration" as const,
                title: "Паспорт (страница с пропиской)",
                entries: registrationEntries,
              },
              { key: "egrnExtract" as const, title: "Выписка ЕГРН", entries: egrnEntries },
            ].map((block) => (
              <section
                key={block.key}
                className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-8"
              >
                <h3 className="mb-4 text-lg font-semibold text-black">{block.title}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {block.entries.map(({ key, label, value }) => (
                    <div
                      key={key}
                      className="rounded-2xl border border-slate-200/90 bg-slate-50/50 px-4 py-3.5 shadow-sm transition hover:border-blue-200/80 hover:bg-white hover:shadow-md"
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-black">
                        {label}
                      </div>
                      {block.key === "passportMain" ? (
                        <input
                          type="text"
                          value={String(value ?? "")}
                          onChange={(e) =>
                            handlePassportFieldChange(key as keyof PassportData, e.target.value)
                          }
                          className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-medium leading-snug text-black focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      ) : block.key === "egrnExtract" ? (
                        <input
                          type="text"
                          value={String(value ?? "")}
                          onChange={(e) =>
                            handleEgrnFieldChange(key as keyof EgrnExtractData, e.target.value)
                          }
                          className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-medium leading-snug text-black focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      ) : (
                        <div className="mt-1.5 break-words text-sm font-medium leading-snug text-black">
                          {Array.isArray(value)
                            ? value.length
                              ? value.join(", ")
                              : "—"
                            : String(value || "").trim() || "—"}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setRawOpenByKey((prev) => ({
                      ...prev,
                      [block.key]: !prev[block.key],
                    }))
                  }
                  className="mt-5 flex w-full items-center justify-between rounded-2xl border border-slate-200/90 bg-slate-50/80 px-4 py-3.5 text-left text-sm font-medium text-slate-900 shadow-sm transition hover:bg-slate-100"
                >
                  <span>Сырой ответ модели</span>
                  {rawOpenByKey[block.key] ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </button>
                {rawOpenByKey[block.key] && (
                  <textarea
                    readOnly
                    value={
                      scanResult.raw_text[
                        UPLOAD_SLOTS.find((slot) => slot.key === block.key)?.apiField ?? "passport_main"
                      ]
                    }
                    className="mt-2 min-h-[220px] w-full resize-y rounded-2xl border border-[color:var(--ph-border)] bg-[color:var(--ph-pre-bg)] px-4 py-3 font-mono text-xs leading-relaxed text-[color:var(--ph-muted)] shadow-inner"
                  />
                )}
              </section>
            ))}

            <section className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-900/5 sm:p-8">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleBuildContract}
                  disabled={buildingContract}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {buildingContract ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <FileDown className="size-4" aria-hidden />
                  )}
                  Создать договор (.docx)
                </button>
                {contractBlob && downloadHref && (
                  <a
                    href={downloadHref}
                    download={contractFilename ?? "dogovor.docx"}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-blue-300 hover:bg-blue-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  >
                    <FileDown className="size-4" aria-hidden />
                    Скачать договор
                  </a>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
