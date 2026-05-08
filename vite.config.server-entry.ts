import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import path from "node:path";

export default defineConfig({
  define: {
    __MC_LICENSE_PUBLIC_KEY__: JSON.stringify(process.env.MC_LICENSE_PUBLIC_KEY ?? ""),
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [
    tanstackStart({
      srcDirectory: "src",
    }),
  ],
  ssr: {
    external: ["better-sqlite3", "node-pty"],
  },
  build: {
    target: "node22",
    outDir: "dist-server",
    ssr: true,
  },
});
