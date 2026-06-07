// The hook env/URL builder lives in src/shared/mission-control-hook-env.ts as
// the single source of truth so the remote sandbox agent can build the same hook
// env/URLs (parameterized by host: 127.0.0.1 on the Electron host vs
// host.docker.internal inside the sandbox). Re-exported here to preserve existing
// electron/ import paths and tests.
export {
  type PtyHookEnv,
  SANDBOX_HOOK_API_HOST,
  LOCAL_HOOK_API_HOST,
  buildMissionControlApiUrl,
  buildLocalMissionControlApiUrl,
  buildSandboxMissionControlApiUrl,
  hookEndpointSlug,
  buildSyntheticHookUrl,
} from "../src/shared/mission-control-hook-env";
