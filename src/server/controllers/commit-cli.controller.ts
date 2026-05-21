import { COMMIT_CLI_VALUES, type CommitCliDetection } from "~/shared/commit-cli";
import { detectInstalledCommitClis } from "../services/commit-cli";
import { json } from "./_helpers";

const EMPTY_DETECTION: CommitCliDetection = Object.fromEntries(
  COMMIT_CLI_VALUES.map((cli) => [cli, false] as const),
) as CommitCliDetection;

/** GET /api/commit-cli/detect — returns which supported CLIs are reachable
 * on the user's PATH (resolved through their login shell, same as Ship does).
 * Called from the Defaults settings panel and by the Ship error UX so the
 * user sees install status next to each option.
 *
 * Never throws: probe failures degrade to the all-false shape so the client
 * always receives a typed `detected` map and can render its UI. The error
 * message is folded into the response so the UI can surface diagnostics. */
export async function detect(): Promise<Response> {
  try {
    const detected = await detectInstalledCommitClis();
    return json({ detected });
  } catch (e) {
    console.error(
      `[commit-cli] detect endpoint fell back to empty shape: ${(e as Error)?.message ?? String(e)}`,
    );
    return json({
      detected: EMPTY_DETECTION,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
