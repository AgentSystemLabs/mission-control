import { z } from "zod";
import { json, jsonError } from "../auth";
import {
  ConflictError,
  DomainError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../errors";
import {
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_NO_CONTENT,
  HTTP_NOT_FOUND,
  HTTP_UNAUTHORIZED,
} from "~/shared/http-status";

export { json, jsonError };

// Standard `:id` path-parameter schema reused by every controller that
// extracts an id from the URL.
export const idParam = z.string().min(1);

export function noContent(): Response {
  return new Response(null, { status: HTTP_NO_CONTENT });
}

export function notFound(message = "not found"): Response {
  return jsonError(HTTP_NOT_FOUND, message);
}

async function readBodyText(request: Request): Promise<string> {
  if (!request.body) return "";
  try {
    return await request.text();
  } catch {
    return "";
  }
}

/** Parse + validate a JSON body in one step. Returns either parsed data or an error Response. */
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  const text = await readBodyText(request);
  let raw: unknown = {};
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, response: jsonError(HTTP_BAD_REQUEST, "invalid JSON body") };
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, response: jsonError(HTTP_BAD_REQUEST, zodMessage(result.error)) };
  }
  return { ok: true, data: result.data };
}

/** Parse + validate URL search params (each value is a string). */
export function parseSearchParams<S extends z.ZodType>(
  url: URL,
  schema: S,
): { ok: true; data: z.infer<S> } | { ok: false; response: Response } {
  const obj = Object.fromEntries(url.searchParams.entries());
  const result = schema.safeParse(obj);
  if (!result.success) {
    return { ok: false, response: jsonError(HTTP_BAD_REQUEST, zodMessage(result.error)) };
  }
  return { ok: true, data: result.data };
}

/** Parse + validate route params extracted by the router (e.g., decoded :id). */
export function parsePathParams<S extends z.ZodType>(
  raw: Record<string, string>,
  schema: S,
): { ok: true; data: z.infer<S> } | { ok: false; response: Response } {
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, response: jsonError(HTTP_BAD_REQUEST, zodMessage(result.error)) };
  }
  return { ok: true, data: result.data };
}

function zodMessage(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "invalid request";
  const path = first.path.length ? `${first.path.join(".")}: ` : "";
  return `${path}${first.message}`;
}

/**
 * Map a thrown domain error to its HTTP response. Re-throws unknown errors so
 * the outer handler still surfaces a 400/500 with the original message.
 */
export function handleDomainError(e: unknown): Response | null {
  if (e instanceof NotFoundError) return jsonError(HTTP_NOT_FOUND, e.message);
  if (e instanceof ValidationError) return jsonError(HTTP_BAD_REQUEST, e.message);
  if (e instanceof UnauthorizedError) return jsonError(HTTP_UNAUTHORIZED, e.message);
  if (e instanceof ConflictError) return jsonError(HTTP_CONFLICT, e.message);
  if (e instanceof DomainError) return jsonError(HTTP_BAD_REQUEST, e.message);
  return null;
}
