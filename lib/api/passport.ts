const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const PASSPORT_HF_API_URL = `${API_BASE_URL}/scan-passport`;
const PASSPORT_TO_CONTRACT_HF_API_URL = `${API_BASE_URL}/scan-passport-to-contract-hf`;
const UNIFIED_SCAN_API_URL = `${API_BASE_URL}/scan-documents-unified`;
const UNIFIED_CONTRACT_API_URL = `${API_BASE_URL}/unified-json-to-contract`;

const HF_SEC = Number(process.env.NEXT_PUBLIC_HF_REQUEST_TIMEOUT_SEC ?? 90);
const FETCH_TIMEOUT_MS = (10 + HF_SEC + 45) * 1000;
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

export type ApiError = Error & {
  code?: "timeout" | "connection" | "api" | "download";
};

export { API_BASE_URL, HF_SEC };

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
  try {
    const errBody = (await response.json()) as { detail?: unknown };
    if (errBody.detail !== undefined) {
      msg += `\n${formatApiDetail(errBody.detail)}`;
    }
  } catch {
    msg += `\n${await response.text()}`;
  }
  const err = new Error(msg) as ApiError;
  err.code = "api";
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
): Promise<BuildContractResponse> {
  try {
    const requestPayload: Record<string, unknown> = { ...scanResponse };
    const normalizedOverride = (customerRegistrationAddressOverride ?? "").trim();
    if (normalizedOverride) {
      requestPayload.customer_registration_address_override = normalizedOverride;
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
