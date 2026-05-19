import { resolve } from "node:path";
import { unpluginRouterGeneratorFactory } from "@tanstack/router-plugin";

const root = resolve(import.meta.dirname, "..");
const plugin = unpluginRouterGeneratorFactory({ srcDirectory: "src" });
await plugin.vite.configResolved({ root });
