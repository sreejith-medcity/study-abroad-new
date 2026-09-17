import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = ReturnType<typeof createDb>;

const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres>; db?: Db };

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = globalForDb.pgClient ?? postgres(url, { max: 10 });
  if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;
  return drizzle(client, { schema });
}

/**
 * Connects on first use, not on import, so `next build` can collect page data
 * without a database and a bad DATABASE_URL fails at request time with a clear error.
 */
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const instance = (globalForDb.db ??= createDb());
    const value = Reflect.get(instance as object, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export { schema };
