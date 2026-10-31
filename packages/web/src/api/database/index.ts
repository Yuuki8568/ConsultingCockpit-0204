import type { D1Database } from "@cloudflare/workers-types";
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

function createDatabase() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.DATABASE_AUTH_TOKEN });
  return { client, db: drizzle(client, { schema }) };
}
type Database = ReturnType<typeof createDatabase>["db"];
export const databaseContext = new AsyncLocalStorage<{ db: Database; auth?: unknown; migrationDb?: D1Database }>();
let localDatabase: ReturnType<typeof createDatabase> | undefined;
export const db = new Proxy({} as Database, {
  get(_target, property) {
    const current = databaseContext.getStore()?.db ?? (localDatabase ??= createDatabase()).db;
    const value = Reflect.get(current, property);
    return typeof value === "function" ? value.bind(current) : value;
  },
});
export async function withDatabase<T>(run: () => Promise<T>, migrationDb?: D1Database): Promise<T> {
  const database = createDatabase();
  try { return await databaseContext.run({ db: database.db, migrationDb }, run); }
  finally { database.client.close(); }
}
