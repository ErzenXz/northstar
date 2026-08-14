import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (database) return database;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  client = postgres(url, { max: Number(process.env.DATABASE_POOL_SIZE ?? 10) });
  database = drizzle(client, { schema });
  return database;
}

export async function closeDb() {
  await client?.end();
  client = undefined;
  database = undefined;
}

export * from "./schema";
