const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const PASSPORT_HF_API_URL = `${API_BASE_URL}/scan-passport`;
const PASSPORT_TO_CONTRACT_HF_API_URL = `${API_BASE_URL}/scan-passport-to-contract-hf`;
const UNIFIED_SCAN_API_URL = `${API_BASE_URL}/scan-documents-unified`;
const UNIFIED_TWO_MODELS_SCAN_API_URL = `${API_BASE_URL}/scan-documents-unified-two-models`;
const UNIFIED_TESSERACT_SCAN_API_URL = `${API_BASE_URL}/scan-documents-unified-tesseract`;
const UNIFIED_CONTRACT_API_URL = `${API_BASE_URL}/unified-json-to-contract`;

const HF_SEC = Number(process.env.NEXT_PUBLIC_HF_REQUEST_TIMEOUT_SEC ?? 90);
const FETCH_TIMEOUT_MS = (10 + HF_SEC + 45) * 1000;
/** Tesseract: три OCR подряд, без HF */
const TESSERACT_FETCH_TIMEOUT_MS = Number(
  process.env.NEXT_PUBLIC_TESSERACT_TIMEOUT_MS ?? 180_000,
);
const DOWNLOAD_TIMEOUT_MS = 120_000;

export type PassportData = {
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

export type ScanResponse = {
  ok: boolean;
  model: string;
  data: PassportData;
  raw_text: string;
};

export type BuildContractResponse = {
  blob: Blob;
  filename: string;
};

export type PassportRegistrationData = {
  address: string;
  region: string;
  city: string;
  settlement: string;
  street: string;
  house: string;
  building: string;
  apartment: string;
  registration_date: string;
  confidence_note: string;
};

export type EgrnExtractData = {
  cadastral_number: string;
  object_type: string;
  address: string;
  area_sq_m: string;
  ownership_type: string;
  right_holders: string[];
  extract_date: string;
  confidence_note: string;
};

export type UnifiedScanResponse = {
  ok: boolean;
  model: string;
  data: {
    passport_main: PassportData;
    passport_registration: PassportRegistrationData;
    egrn_extract: EgrnExtractData;
  };
  raw_text: {
    passport_main: string;
    passport_registration: string;
    egrn_extract: string;
  };
};

export type UnifiedTwoModelsScanResponse = {
  ok: boolean;
  models: Record<string, string>;
  data: Record<string, UnifiedScanResponse>;
};

export type ApiError = Error & {
  code?: "timeout" | "connection" | "api" | "download";
  status?: number;
  detail?: string;
};

export { API_BASE_URL, HF_SEC, TESSERACT_FETCH_TIMEOUT_MS };

function normalizeCustomerAddress(value: string): string {
  const compact = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ");
  if (!compact) return "";
  const parts = compact.split(",").map((part) => part.trim()).filter(Boolean);
  return parts
    .map((part, index) => {
      let normalized = part.replace(/\bобласть\b/gi, "обл.");
      normalized = normalized.replace(/^\s*город\s+/i, "г. ");
      normalized = normalized.replace(/^\s*улица\s+/i, "ул. ");
      if (
        index === 1 &&
        !/^(г\.|город|пгт|пос\.|с\.|дер\.)\s+/i.test(normalized) &&
        !/^(ул\.|улица|просп\.|проспект|пер\.|переулок|бул\.|бульвар|ш\.|шоссе)\s+/i.test(normalized) &&
        !/^(д\.|дом|кв\.|корп\.|стр\.)\s*/i.test(normalized)
      ) {
        normalized = `г. ${normalized}`;
      }
      return normalized;
    })
    .join(", ");
}

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

export function formatApiDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}

async function toApiErrorFromResponse(response: Response): Promise<ApiError> {
  let msg = `Ошибка API: ${response.status}`;
  let detailText = "";
  try {
    const errBody = (await response.json()) as { detail?: unknown };
    if (errBody.detail !== undefined) {
      detailText = formatApiDetail(errBody.detail);
      msg += `\n${detailText}`;
    }
  } catch {
    detailText = await response.text();
    msg += `\n${detailText}`;
  }
  const err = new Error(msg) as ApiError;
  err.code = "api";
  err.status = response.status;
  err.detail = detailText;
  return err;
}

function toNetworkError(error: unknown, timeoutMessage: string): ApiError {
  if (error instanceof Error && error.name === "AbortError") {
    const err = new Error(timeoutMessage) as ApiError;
    err.code = "timeout";
    return err;
  }
  if (error instanceof TypeError) {
    const err = new Error("Не удалось подключиться к FastAPI.") as ApiError;
    err.code = "connection";
    return err;
  }
  return (error instanceof Error ? error : new Error("Неизвестная ошибка")) as ApiError;
}

export async function scanPassport(file: File): Promise<ScanResponse> {
  const form = new FormData();
  form.append("file", file);
  try {
    const response = await fetchWithTimeout(
      PASSPORT_HF_API_URL,
      { method: "POST", body: form },
      FETCH_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw await toApiErrorFromResponse(response);
    }
    return (await response.json()) as ScanResponse;
  } catch (error: unknown) {
    throw toNetworkError(
      error,
      `Превышено время ожидания (бэкенд HF ~${HF_SEC} с). Убедитесь, что uvicorn запущен; при перегрузке HF увеличьте HF_REQUEST_TIMEOUT_SEC.`,
    );
  }
}

export async function scanDocumentsUnified(files: {
  passportMain: File;
  passportRegistration: File;
  egrnExtract: File;
}): Promise<UnifiedScanResponse> {
  const form = new FormData();
  form.append("passport_main", files.passportMain);
  form.append("passport_registration", files.passportRegistration);
  form.append("egrn_extract", files.egrnExtract);

  try {
    const response = await fetchWithTimeout(
      UNIFIED_SCAN_API_URL,
      { method: "POST", body: form },
      FETCH_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw await toApiErrorFromResponse(response);
    }
    return (await response.json()) as UnifiedScanResponse;
  } catch (error: unknown) {
    throw toNetworkError(
      error,
      `Превышено время ожидания (бэкенд HF ~${HF_SEC} с). Убедитесь, что uvicorn запущен; при перегрузке HF увеличьте HF_REQUEST_TIMEOUT_SEC.`,
    );
  }
}

export async function scanDocumentsUnifiedWithModel(
  files: {
    passportMain: File;
    passportRegistration: File;
    egrnExtract: File;
  },
  hfModel: string,
): Promise<UnifiedScanResponse> {
  const form = new FormData();
  form.append("passport_main", files.passportMain);
  form.append("passport_registration", files.passportRegistration);
  form.append("egrn_extract", files.egrnExtract);
  form.append("hf_model", hfModel);

  try {
    const response = await fetchWithTimeout(
      UNIFIED_SCAN_API_URL,
      { method: "POST", body: form },
      FETCH_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw await toApiErrorFromResponse(response);
    }
    return (await response.json()) as UnifiedScanResponse;
  } catch (error: unknown) {
    throw toNetworkError(
      error,
      `Превышено время ожидания (бэкенд HF ~${HF_SEC} с). Убедитесь, что uvicorn запущен; при перегрузке HF увеличьте HF_REQUEST_TIMEOUT_SEC.`,
    );
  }
}

export async function scanDocumentsUnifiedTwoModels(files: {
  passportMain: File;
  passportRegistration: File;
  egrnExtract: File;
}): Promise<UnifiedTwoModelsScanResponse> {
  const form = new FormData();
  form.append("passport_main", files.passportMain);
  form.append("passport_registration", files.passportRegistration);
  form.append("egrn_extract", files.egrnExtract);

  try {
    const response = await fetchWithTimeout(
      UNIFIED_TWO_MODELS_SCAN_API_URL,
      { method: "POST", body: form },
      FETCH_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw await toApiErrorFromResponse(response);
    }
    return (await response.json()) as UnifiedTwoModelsScanResponse;
  } catch (error: unknown) {
    throw toNetworkError(
      error,
      `Превышено время ожидания (бэкенд HF ~${HF_SEC} с). Убедитесь, что uvicorn запущен; при перегрузке HF увеличьте HF_REQUEST_TIMEOUT_SEC.`,
    );
  }
}

/**
 * Те же поля, что unified HF, но только Tesseract + правила на бэкенде (`/scan-documents-unified-tesseract`).
 * Дальше договор собирается тем же `POST /unified-json-to-contract`.
 */
export async function scanDocumentsUnifiedTesseract(files: {
  passportMain: File;
  passportRegistration: File;
  egrnExtract: File;
}): Promise<UnifiedScanResponse> {
  const form = new FormData();
  form.append("passport_main", files.passportMain);
  form.append("passport_registration", files.passportRegistration);
  form.append("egrn_extract", files.egrnExtract);

  try {
    const response = await fetchWithTimeout(
      UNIFIED_TESSERACT_SCAN_API_URL,
      { method: "POST", body: form },
      TESSERACT_FETCH_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw await toApiErrorFromResponse(response);
    }
    return (await response.json()) as UnifiedScanResponse;
  } catch (error: unknown) {
    throw toNetworkError(
      error,
      `Превышено время ожидания Tesseract (${Math.round(TESSERACT_FETCH_TIMEOUT_MS / 1000)} с). Проверьте, что uvicorn запущен и Tesseract установлен.`,
    );
  }
}

export async function buildContractFromPassport(
  file: File,
): Promise<BuildContractResponse> {
  const form = new FormData();
  form.append("file", file);
  try {
    const response = await fetchWithTimeout(
      PASSPORT_TO_CONTRACT_HF_API_URL,
      { method: "POST", body: form },
      FETCH_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw await toApiErrorFromResponse(response);
    }

    const payload = (await response.json()) as {
      download_url?: string;
      generated_filename?: string;
    };
    const downloadUrl = payload.download_url;
    if (!downloadUrl) {
      const err = new Error("API не вернул ссылку для скачивания договора.") as ApiError;
      err.code = "api";
      throw err;
    }

    const fileResponse = await fetchWithTimeout(
      `${API_BASE_URL}${downloadUrl}`,
      { method: "GET" },
      DOWNLOAD_TIMEOUT_MS,
    );
    if (!fileResponse.ok) {
      const err = new Error(`Ошибка скачивания файла: ${fileResponse.status}`) as ApiError;
      err.code = "download";
      throw err;
    }

    const blob = await fileResponse.blob();
    const filename = payload.generated_filename ?? downloadUrl.split("/").pop() ?? "dogovor.docx";
    return { blob, filename };
  } catch (error: unknown) {
    if ((error as ApiError)?.code) {
      throw error;
    }
    throw toNetworkError(
      error,
      `Превышено время ожидания (HF ~${HF_SEC} с). Повторите или увеличьте HF_REQUEST_TIMEOUT_SEC.`,
    );
  }
}

export async function buildContractFromUnifiedJson(
  scanResponse: UnifiedScanResponse,
  customerRegistrationAddressOverride?: string,
  ownershipBasisDocumentOverride?: string,
  customerEmailOverride?: string,
  customerPhoneOverride?: string,
): Promise<BuildContractResponse> {
  try {
    const requestPayload: Record<string, unknown> = { ...scanResponse };
    const normalizedOverride = normalizeCustomerAddress(customerRegistrationAddressOverride ?? "");
    if (normalizedOverride) {
      requestPayload.customer_registration_address_override = normalizedOverride;
    }
    const normalizedOwnershipBasis = (ownershipBasisDocumentOverride ?? "").trim();
    if (normalizedOwnershipBasis) {
      requestPayload.ownership_basis_document_override = normalizedOwnershipBasis;
    }
    const normalizedCustomerEmail = (customerEmailOverride ?? "").trim();
    if (normalizedCustomerEmail) {
      requestPayload.customer_email_override = normalizedCustomerEmail;
    }
    const normalizedCustomerPhone = (customerPhoneOverride ?? "").trim();
    if (normalizedCustomerPhone) {
      requestPayload.customer_phone_override = normalizedCustomerPhone;
    }

    const response = await fetchWithTimeout(
      UNIFIED_CONTRACT_API_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      },
      FETCH_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw await toApiErrorFromResponse(response);
    }

    const payload = (await response.json()) as {
      download_url?: string;
      generated_filename?: string;
    };
    const downloadUrl = payload.download_url;
    if (!downloadUrl) {
      const err = new Error("API не вернул ссылку для скачивания договора.") as ApiError;
      err.code = "api";
      throw err;
    }

    const fileResponse = await fetchWithTimeout(
      `${API_BASE_URL}${downloadUrl}`,
      { method: "GET" },
      DOWNLOAD_TIMEOUT_MS,
    );
    if (!fileResponse.ok) {
      const err = new Error(`Ошибка скачивания файла: ${fileResponse.status}`) as ApiError;
      err.code = "download";
      throw err;
    }

    const blob = await fileResponse.blob();
    const filename = payload.generated_filename ?? downloadUrl.split("/").pop() ?? "dogovor.docx";
    return { blob, filename };
  } catch (error: unknown) {
    if ((error as ApiError)?.code) {
      throw error;
    }
    throw toNetworkError(
      error,
      `Превышено время ожидания (бэкенд HF ~${HF_SEC} с). Убедитесь, что uvicorn запущен; при перегрузке HF увеличьте HF_REQUEST_TIMEOUT_SEC.`,
    );
  }
}
