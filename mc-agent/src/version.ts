import pkg from "../package.json" with { type: "json" };

/** Runtime/agent protocol version — always matches package.json for npm releases. */
export const AGENT_VERSION = pkg.version;
