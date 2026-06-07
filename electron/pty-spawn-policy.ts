// The spawn allow-list (agent binaries, argv validation, project-root
// containment) lives in src/shared/pty-spawn-policy.ts as the single source of
// truth. Re-exported here to preserve existing electron/ import paths and tests.
export * from "../src/shared/pty-spawn-policy";
