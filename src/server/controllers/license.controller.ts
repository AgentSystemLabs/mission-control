import { z } from "zod";
import { readLicenseState, removeLicense, validateLicense } from "../services/license";
import { handleDomainError, json, parseJsonBody } from "./_helpers";

const validateBody = z.object({
  key: z.string().min(1, "key required"),
});

export function read(): Response {
  return json({ license: readLicenseState() });
}

export function remove(): Response {
  return json({ license: removeLicense() });
}

export async function validate(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, validateBody);
  if (!parsed.ok) return parsed.response;
  try {
    const license = await validateLicense(parsed.data.key);
    return json({ license });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}
