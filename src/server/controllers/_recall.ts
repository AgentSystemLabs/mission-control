import { readRecallSettings } from "../services/recall-settings";
import { forbidden } from "./_helpers";

/** 403 when the Recall master switch is off; null when the request may proceed. */
export function requireRecallOn(): Response | null {
  return readRecallSettings().enabled ? null : forbidden("Recall is disabled");
}
