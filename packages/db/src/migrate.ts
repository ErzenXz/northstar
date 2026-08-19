import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "./index";

await migrate(getDb(), { migrationsFolder: "./drizzle" });
await closeDb();
console.log("Northstar database is up to date.");
