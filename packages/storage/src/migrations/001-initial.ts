/**
 * @module 001-initial
 * Initial database migration.
 */
import type { Database } from 'better-sqlite3';

export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dna_store (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (namespace, key)
    );

    CREATE INDEX IF NOT EXISTS idx_dna_store_namespace
      ON dna_store (namespace);
  `);
}
