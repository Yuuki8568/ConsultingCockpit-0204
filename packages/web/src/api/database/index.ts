import type { WitnessService } from "../security/witness";
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { matchesSourceHost } from "./source-host";

function createDatabase() {
  const url = process.env.DATABASE_URL!;
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  return { client, db: drizzle(client, { schema }), checkSourceHost: (expected: string) => matchesSourceHost(url, expected) };
}
type Database = ReturnType<typeof createDatabase>["db"];
export const databaseContext = new AsyncLocalStorage<{ db: Database; auth?: unknown; witness?:WitnessService;
  checkSourceHost?: (expected: string) => Promise<boolean> }>();
let localDatabase: ReturnType<typeof createDatabase> | undefined;
export const db = new Proxy({} as Database, {
  get(_target, property) {
    const current = databaseContext.getStore()?.db ?? (localDatabase ??= createDatabase()).db;
    const value = Reflect.get(current, property);
    return typeof value === "function" ? value.bind(current) : value;
  },
});
export async function currentSourceHostMatches(expected: string): Promise<boolean> {
  const context = databaseContext.getStore();
  const check = context ? context.checkSourceHost : localDatabase?.checkSourceHost;
  return check ? check(expected) : false;
}
export async function withDatabase<T>(run: () => Promise<T>,witness?:WitnessService): Promise<T> {
  const database = createDatabase();
  try { return await databaseContext.run({ db: database.db, witness, checkSourceHost: database.checkSourceHost }, run); }
  finally { database.client.close(); }
}
