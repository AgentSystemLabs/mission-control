import { Pool } from "pg";

let pool: Pool | null = null;

export function getHostedDatabaseUrl(): string | null {
  return process.env.DATABASE_URL?.trim() || null;
}

export function isHostedDatabaseEnabled(): boolean {
  return !!getHostedDatabaseUrl();
}

export function getHostedPool(): Pool {
  if (pool) return pool;
  const connectionString = getHostedDatabaseUrl();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for hosted persistence");
  }
  pool = new Pool({ connectionString });
  return pool;
}

