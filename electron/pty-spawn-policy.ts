// Moved to src/shared/pty-spawn-policy.ts so the sandbox runner's mc-agent can
// reuse the exact same spawn allow-list (agent binaries, argv validation,
// project-root containment) instead of duplicating it. Re-exported here to
// preserve existing electron/ import paths and tests.
export * from "../src/shared/pty-spawn-policy";
