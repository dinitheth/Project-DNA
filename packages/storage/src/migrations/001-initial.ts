/**
 * @module 001-initial
 * Initial database migration.
 */
import type { Database } from 'better-sqlite3';

export function migrate(_db: Database): void {
  // TODO: create table dna_store (namespace TEXT, key TEXT, value TEXT, created_at INTEGER, updated_at INTEGER, PRIMARY KEY (namespace, key))
}
