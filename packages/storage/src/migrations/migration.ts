import type { Database } from 'better-sqlite3';

/** One forward-only SQLite schema migration. */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: (database: Database) => void;
}
