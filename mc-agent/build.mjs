// Bundle the sandbox agent into a single CommonJS file the Docker image runs.
// node-pty is a native addon and stays external (installed in the image so it
// builds against the container's Node ABI); ws + ignore are pure JS and inline.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(dir, "src/index.ts")],
  outfile: path.join(dir, "dist/mc-agent.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["node-pty"],
  banner: {
    js: "/* Mission Control sandbox agent — bundled by mc-agent/build.mjs. node-pty is external. */",
  },
  logLevel: "info",
});
