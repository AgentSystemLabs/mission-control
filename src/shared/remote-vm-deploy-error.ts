/**
 * True when a remote-VM CLI error means the cloud instance no longer exists —
 * it was terminated/deleted out-of-band (e.g. in the AWS console) and aged out
 * of the provider API. Terminating or resuming such an instance is a no-op, so
 * the caller should surface "this VM is gone" instead of a hard failure.
 */
export function isMissingRemoteInstanceError(message: string | null | undefined): boolean {
  return /InvalidInstanceID\.NotFound|instance ID .* does not exist|instance .* not found/i.test(
    String(message ?? ""),
  );
}

/** Pull the last actionable CLI error out of deploy job output for user-facing toasts. */
export function extractRemoteVmDeployError(output: string): string | null {
  const lines = output.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim();
    if (!line) continue;
    if (line.startsWith("[remote-vm]")) {
      const message = line.slice("[remote-vm]".length).trim();
      if (message && !message.startsWith("starting deploy job")) return message;
      continue;
    }
    if (/^error:/i.test(line) || / failed:/i.test(line)) return line;
  }
  return null;
}
