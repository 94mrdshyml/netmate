import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Db = DrizzleD1Database<typeof schema>;

/** Wraps a D1 binding. Cheap, so build one per request; bindings exist only inside a request. */
export function getDb(d1: D1Database): Db {
  return drizzle(d1, { schema });
}

export { schema };
