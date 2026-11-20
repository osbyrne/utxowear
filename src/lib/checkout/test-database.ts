import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { CheckoutDatabase } from "./orders";

const migration = readFileSync(
  new URL("../../../migrations/0001_checkout_orders.sql", import.meta.url),
  "utf8",
);

/** An in-memory SQLite database with the checkout migration applied, exposed as a D1-shaped binding. */
export function createCheckoutTestDatabase(): { sqlite: DatabaseSync; db: CheckoutDatabase } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration);
  const db: CheckoutDatabase = {
    prepare(query) {
      return {
        bind(...values) {
          return {
            async run() {
              return { meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } };
            },
            async first<T>() {
              return (sqlite.prepare(query).get(...values) ?? null) as T | null;
            },
          };
        },
      };
    },
  };
  return { sqlite, db };
}
