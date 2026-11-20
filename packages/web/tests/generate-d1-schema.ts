// Generate a fresh schema from current declarations; no remote DB credentials.
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { pushSQLiteSchema } from "drizzle-kit/api";
import * as schema from "../src/api/database/schema";
import { writeFileSync } from "node:fs";
const c = createClient({ url: ":memory:" });
try {
  const plan = await pushSQLiteSchema(schema, drizzle(c, { schema }));
  writeFileSync(
    "../../cloudflare/d1/business-schema.sql",
    "-- Generated from current Drizzle schema. Apply only to an empty migration target.\n" +
      plan.statementsToExecute.join(";\n") +
      ";\n",
  );
} finally {
  c.close();
}
