import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL } from "node:url";

// Real SQLite executes production SQL. The later workerd smoke covers the D1 binding.
export function testDatabase(migrations = "admin-migrations") {
  const sqlite = new DatabaseSync(":memory:");
  const directory = new URL(`../${migrations}/`, import.meta.url);
  for (const name of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(name, directory), "utf8"));
  class Statement {
    constructor(readonly sql: string, readonly params: SQLInputValue[] = []) {}
    bind(...params: (SQLInputValue | ArrayBuffer)[]) { return new Statement(this.sql, params.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value)); }
    async first() { return sqlite.prepare(this.sql).get(...this.params) ?? null; }
    async all() { return { success: true, results: sqlite.prepare(this.sql).all(...this.params), meta: {} }; }
    async run() { const result = sqlite.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: Number(result.changes) } }; }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  return { db, sqlite };
}
