/**
 * Applies pending Drizzle migrations.
 *
 * Used as the Railway release command and for local setup. Kept as a script
 * rather than `drizzle-kit migrate` so production does not need drizzle-kit,
 * which is a dev dependency.
 */
import "@/server/env-load";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "@/db";

async function main(): Promise<void> {
  console.log("[migrate] applying migrations");
  await migrate(db(), { migrationsFolder: "./drizzle" });
  console.log("[migrate] up to date");
}

main()
  .catch((error) => {
    console.error("[migrate] failed", error);
    process.exitCode = 1;
  })
  .finally(() => void closeDb());
