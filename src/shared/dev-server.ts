import { env } from "./env";

export const DEV_SERVER_HOST = env.MC_DEV_HOST ?? "127.0.0.1";
export const DEV_SERVER_PORT = env.MC_DEV_PORT ?? 5173;
export const DEV_SERVER_ORIGIN =
  env.MC_SERVER_ORIGIN ??
  env.MC_DEV_URL ??
  `http://${DEV_SERVER_HOST}:${DEV_SERVER_PORT}`;
