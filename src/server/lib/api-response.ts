import type { ApiErrorDetails, ApiErrorEnvelope } from "~/shared/api-errors";

type JsonErrorOptions = {
  code?: string;
  details?: ApiErrorDetails;
  requestId?: string;
  headers?: HeadersInit;
  extra?: Record<string, unknown>;
};

export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export function jsonError(
  status: number,
  message: string,
  options: JsonErrorOptions = {},
): Response {
  const body: ApiErrorEnvelope = {
    error: message,
    ...(options.code ? { code: options.code } : {}),
    ...(options.details ? { details: options.details } : {}),
    ...(options.requestId ? { requestId: options.requestId } : {}),
    ...(options.extra ?? {}),
  };

  return json(body, {
    status,
    headers: options.headers,
  });
}
