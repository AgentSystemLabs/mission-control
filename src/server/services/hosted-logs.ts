import { AsyncLocalStorage } from "node:async_hooks";

type HostedLogFields = Record<string, string | number | boolean | null | undefined>;

const hostedLogContext = new AsyncLocalStorage<HostedLogFields>();

export function withHostedLogContext<T>(fields: HostedLogFields, fn: () => T): T {
  return hostedLogContext.run({ ...(hostedLogContext.getStore() ?? {}), ...fields }, fn);
}

export function logHostedEvent(
  event: string,
  fields: HostedLogFields = {},
  level: "info" | "warn" | "error" = "info",
): void {
  if (process.env.VITEST) return;
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...(hostedLogContext.getStore() ?? {}),
    ...fields,
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
