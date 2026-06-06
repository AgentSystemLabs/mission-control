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
