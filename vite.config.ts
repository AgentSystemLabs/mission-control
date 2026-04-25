import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { missionControlApi } from "./src/server/vite-api-plugin";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
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
    exclude: ["better-sqlite3", "node-pty"],
  },
  ssr: {
    external: ["better-sqlite3", "node-pty"],
    noExternal: ["@xterm/xterm", "@xterm/addon-fit"],
  },
});
