// Moved to src/shared/agent-hooks.ts so the sandbox runner's mc-agent can
// install the same Mission Control hook config inside the container. Re-exported
// here to preserve existing electron/ + server import paths and tests.
export { installAgentHooks } from "../src/shared/agent-hooks";
