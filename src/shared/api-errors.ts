export type ApiErrorDetails = Record<string, unknown>;

export type ApiErrorEnvelope = {
  error: string;
  code?: string;
  details?: ApiErrorDetails;
  requestId?: string;
} & Record<string, unknown>;

export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  return (
    !!value &&
    typeof value === "object" &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "string"
  );
}

export function apiErrorCode(value: unknown): string | null {
  return isApiErrorEnvelope(value) && typeof value.code === "string"
    ? value.code
    : null;
}
