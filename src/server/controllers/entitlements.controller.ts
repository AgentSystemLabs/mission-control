import { json } from "./_helpers";
import { getHostedAuthContext } from "../hosted-auth-context";
import { readEntitlements } from "../services/entitlements";
import { isElectronLocalApiRequest } from "../request-runtime";

export async function read(request: Request): Promise<Response> {
  if (isElectronLocalApiRequest(request)) {
    return json({ entitlements: await readEntitlements(null, { hostedEnabled: false }) });
  }
  const context = await getHostedAuthContext(request);
  return json({ entitlements: await readEntitlements(context) });
}

