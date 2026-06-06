import { spawnSync } from "node:child_process";

export type RailwayPreflightResult = { ok: true } | { ok: false; error: string };

export const RAILWAY_CLI_INSTALL_HINT =
  "Install the Railway CLI (https://docs.railway.com/cli) and run `railway login`.";

export const RAILWAY_CLI_LOGIN_HINT =
  "Railway CLI is not logged in. Run `railway login` in your terminal so Mission Control can deploy, then retry.";

export function checkRailwayPreflight(env: NodeJS.ProcessEnv = process.env): RailwayPreflightResult {
  const versionProbe = spawnSync("railway", ["--version"], { stdio: "ignore", env });
  if (versionProbe.error && "code" in versionProbe.error && versionProbe.error.code === "ENOENT") {
    return { ok: false, error: `railway CLI is required. ${RAILWAY_CLI_INSTALL_HINT}` };
  }

  const gitProbe = spawnSync("git", ["--version"], { stdio: "ignore", env });
  if (gitProbe.error && "code" in gitProbe.error && gitProbe.error.code === "ENOENT") {
    return { ok: false, error: "Git is required for Railway deploy. Install Git and retry." };
  }

  const whoami = spawnSync("railway", ["whoami"], {
    encoding: "utf8",
    env: (() => {
      const railwayEnv: NodeJS.ProcessEnv = { ...env, CI: "1", NO_COLOR: "1" };
      if (!env.MC_RAILWAY_API_TOKEN) {
        delete railwayEnv.RAILWAY_TOKEN;
        delete railwayEnv.RAILWAY_API_TOKEN;
      }
      return railwayEnv;
    })(),
  });
  if ((whoami.status ?? 1) !== 0) {
    return { ok: false, error: RAILWAY_CLI_LOGIN_HINT };
  }

  return { ok: true };
}
