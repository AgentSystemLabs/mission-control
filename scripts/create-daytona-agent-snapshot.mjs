import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const contextDir = resolve(root, "docker/daytona-agent");
const dockerfile = resolve(contextDir, "Dockerfile");

const options = parseArgs(process.argv.slice(2));

if (!existsSync(dockerfile)) {
  console.error(`[daytona-snapshot] missing Dockerfile at ${dockerfile}`);
  process.exit(1);
}

if (!options.skipDockerBuild && !commandExists("docker")) {
  console.error("[daytona-snapshot] docker is required to build the local verification image");
  process.exit(1);
}

if (!options.skipSnapshot && !commandExists("daytona")) {
  console.error("[daytona-snapshot] daytona CLI is required to create the snapshot");
  console.error("[daytona-snapshot] install it with: brew install daytonaio/cli/daytona");
  process.exit(1);
}

if (!options.skipDockerBuild) {
  run("docker", [
    "build",
    ...(options.noCache ? ["--no-cache"] : []),
    "-t",
    options.image,
    contextDir,
  ]);
}

if (!options.skipVerify) {
  run("docker", [
    "run",
    "--rm",
    options.image,
    "bash",
    "-lc",
    "claude --version && codex --version && cursor-agent --version",
  ]);
}

if (options.deleteExistingSnapshot) {
  run("daytona", ["snapshot", "delete", options.snapshot], { allowFailure: true });
}

if (!options.skipSnapshot) {
  const snapshotArgs = [
    "snapshot",
    "create",
    options.snapshot,
    "--dockerfile",
    dockerfile,
  ];
  if (options.cpu) snapshotArgs.push("--cpu", options.cpu);
  if (options.memory) snapshotArgs.push("--memory", options.memory);
  if (options.disk) snapshotArgs.push("--disk", options.disk);
  run("daytona", snapshotArgs);
  console.log(`[daytona-snapshot] snapshot ready: ${options.snapshot}`);
} else {
  console.log(`[daytona-snapshot] local image ready: ${options.image}`);
}

function parseArgs(args) {
  const parsed = {
    snapshot: process.env.DAYTONA_SNAPSHOT?.trim() || "mission-control-cloud-agents",
    image: process.env.MISSION_CONTROL_DAYTONA_IMAGE_TAG?.trim() || "mission-control/daytona-agent:latest",
    cpu: process.env.DAYTONA_SNAPSHOT_CPU?.trim() || "",
    memory: process.env.DAYTONA_SNAPSHOT_MEMORY?.trim() || "",
    disk: process.env.DAYTONA_SNAPSHOT_DISK?.trim() || "",
    noCache: false,
    skipDockerBuild: false,
    skipVerify: false,
    skipSnapshot: false,
    deleteExistingSnapshot: process.env.DAYTONA_DELETE_EXISTING_SNAPSHOT === "1",
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--snapshot":
        parsed.snapshot = requiredValue(args, ++i, arg);
        break;
      case "--image":
        parsed.image = requiredValue(args, ++i, arg);
        break;
      case "--cpu":
        parsed.cpu = requiredValue(args, ++i, arg);
        break;
      case "--memory":
        parsed.memory = requiredValue(args, ++i, arg);
        break;
      case "--disk":
        parsed.disk = requiredValue(args, ++i, arg);
        break;
      case "--no-cache":
        parsed.noCache = true;
        break;
      case "--skip-docker-build":
        parsed.skipDockerBuild = true;
        break;
      case "--skip-verify":
        parsed.skipVerify = true;
        break;
      case "--skip-snapshot":
        parsed.skipSnapshot = true;
        break;
      case "--delete-existing-snapshot":
        parsed.deleteExistingSnapshot = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`[daytona-snapshot] unknown option: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  if (!parsed.snapshot) {
    console.error("[daytona-snapshot] --snapshot is required");
    process.exit(1);
  }

  return parsed;
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    console.error(`[daytona-snapshot] ${flag} requires a value`);
    process.exit(1);
  }
  return value;
}

function run(command, args, opts = {}) {
  console.log(`$ ${command} ${args.map(shellQuote).join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`[daytona-snapshot] failed to run ${command}:`, result.error);
    process.exit(1);
  }

  if (result.status !== 0 && !opts.allowFailure) {
    process.exit(result.status ?? 1);
  }
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], {
    cwd: root,
    env: process.env,
    stdio: "ignore",
  });
  return !result.error && result.status === 0;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function printHelp() {
  console.log(`
Usage: pnpm daytona:snapshot [options]

Builds the isolated Mission Control Daytona agent image, verifies the agent
CLIs, then creates a Daytona snapshot from docker/daytona-agent/Dockerfile.

Options:
  --snapshot <name>              Daytona snapshot name (default: mission-control-cloud-agents)
  --image <tag>                  Local Docker image tag used for verification
  --cpu <count>                  Snapshot CPU allocation passed to Daytona
  --memory <gb>                  Snapshot memory allocation passed to Daytona
  --disk <gb>                    Snapshot disk allocation passed to Daytona
  --no-cache                     Build the local Docker image without cache
  --skip-docker-build            Do not run docker build
  --skip-verify                  Do not run local CLI version checks
  --skip-snapshot                Do not create the Daytona snapshot
  --delete-existing-snapshot     Delete an existing Daytona snapshot first
`);
}
