import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import path from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
) as { version: string };

export default defineConfig({
  define: {
    __MC_LICENSE_PUBLIC_KEY__: JSON.stringify(process.env.MC_LICENSE_PUBLIC_KEY ?? ""),
    __MC_VERSION__: JSON.stringify(pkg.version),
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
    external: ["better-sqlite3", "node-pty", "postgres", "better-auth", "@better-auth/drizzle-adapter"],
  },
  build: {
    target: "node22",
    outDir: "dist-server",
    ssr: true,
  },
});
