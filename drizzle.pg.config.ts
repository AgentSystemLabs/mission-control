import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/pg-schema.ts",
  out: "./src/db/pg-migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
