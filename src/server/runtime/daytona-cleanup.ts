import { serverEnv } from "~/shared/env";

type DaytonaSandbox = { id?: string; sandboxId?: string };
type DaytonaClient = {
  list(): Promise<DaytonaSandbox[]>;
  delete?(sandbox: DaytonaSandbox): Promise<unknown>;
  remove?(sandbox: DaytonaSandbox): Promise<unknown>;
};

const importDaytonaSdk = new Function("return import('@daytona/sdk')") as () => Promise<{ Daytona: new (opts?: { apiKey?: string }) => DaytonaClient }>;

function idOf(sandbox: DaytonaSandbox): string | null {
  return sandbox.id ?? sandbox.sandboxId ?? null;
}

export async function deleteDaytonaSandboxById(sandboxId: string | null | undefined): Promise<void> {
  if (!sandboxId) return;
  const apiKey = serverEnv().DAYTONA_API_KEY;
  if (!apiKey) return;
  const { Daytona } = await importDaytonaSdk();
  const daytona = new Daytona({ apiKey });
  const sandbox = (await daytona.list()).find((s) => idOf(s) === sandboxId);
  if (!sandbox) return;
  if (daytona.delete) await daytona.delete(sandbox);
  else if (daytona.remove) await daytona.remove(sandbox);
}
