import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { readFileSync } from "node:fs";
import { missionControlApi } from "./src/server/vite-api-plugin";
import { DEV_SERVER_HOST, DEV_SERVER_PORT } from "./src/shared/dev-server";

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
) as { version: string };

export default defineConfig({
  define: {
    __MC_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: DEV_SERVER_PORT,
    strictPort: true,
    host: DEV_SERVER_HOST,
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [
    tailwindcss(),
    missionControlApi(),
    tanstackStart({
      srcDirectory: "src",
    }),
  ],
  optimizeDeps: {
    exclude: ["better-sqlite3", "node-pty", "web-tree-sitter"],
  },
  ssr: {
    // web-tree-sitter's emscripten glue resolves its own runtime wasm relative
    // to the module — keep it external so it loads intact from node_modules
    // (like the native deps) instead of being mangled by the bundler.
    external: ["better-sqlite3", "node-pty", "web-tree-sitter"],
    noExternal: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-web-links"],
  },
});
