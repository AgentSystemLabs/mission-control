// The Mission Control hook-config installer lives in src/shared/agent-hooks.ts
// as the single source of truth. Re-exported here to preserve existing electron/
// + server import paths and tests.
export { installAgentHooks } from "../src/shared/agent-hooks";
