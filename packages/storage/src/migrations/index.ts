import type { Database } from 'better-sqlite3';
import { initialMigration } from './001-initial.js';
import type { Migration } from './migration.js';

const MIGRATIONS: readonly Migration[] = [initialMigration];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

interface IntegrityRow {
  readonly quick_check: string;
}

interface TableInfoRow {
  readonly name: string;
  readonly type: string;
  readonly notnull: 0 | 1;
  readonly pk: number;
}

const EXPECTED_DNA_STORE_COLUMNS = [
  { name: 'namespace', type: 'TEXT', notnull: 1, pk: 1 },
  { name: 'key', type: 'TEXT', notnull: 1, pk: 2 },
  { name: 'value', type: 'TEXT', notnull: 1, pk: 0 },
  { name: 'created_at', type: 'INTEGER', notnull: 1, pk: 0 },
  { name: 'updated_at', type: 'INTEGER', notnull: 1, pk: 0 },
] as const;

/** Validate database integrity and any existing Project DNA schema before mutation. */
export function validateDatabaseForMigration(database: Database): void {
  const integrity = database.pragma('quick_check') as IntegrityRow[];
  const integrityMessage = integrity[0]?.quick_check;
  if (
    integrity.length !== 1 ||
    typeof integrityMessage !== 'string' ||
    integrityMessage.toLowerCase() !== 'ok'
  ) {
    const details = integrity.map((row) => row.quick_check).join('; ') || 'no result';
    throw new Error(`SQLite quick_check failed: ${details}`);
  }

  const table = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dna_store'")
    .get();
  const schemaVersion = readSchemaVersion(database);
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `SQLite schema version ${schemaVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`,
    );
  }
  if (table === undefined) {
    if (schemaVersion !== 0) {
      throw new Error('Existing SQLite schema is missing the required dna_store table');
    }
    return;
  }

  const columns = database.pragma('table_info(dna_store)') as TableInfoRow[];
  if (
    columns.length !== EXPECTED_DNA_STORE_COLUMNS.length ||
    columns.some((column, index) => {
      const expected = EXPECTED_DNA_STORE_COLUMNS[index];
      return (
        expected === undefined ||
        column.name !== expected.name ||
        column.type.toUpperCase() !== expected.type ||
        column.notnull !== expected.notnull ||
        column.pk !== expected.pk
      );
    })
  ) {
    throw new Error('Existing dna_store schema is incompatible with Project DNA');
  }
}

/** Apply every pending schema migration in deterministic version order. */
export function migrate(database: Database): void {
  validateRegistry(MIGRATIONS);
  const currentVersion = readSchemaVersion(database);
  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `SQLite schema version ${currentVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;
    const apply = database.transaction(() => {
      migration.up(database);
      database.pragma(`user_version = ${migration.version}`);
    });
    apply.immediate();
  }
}

function readSchemaVersion(database: Database): number {
  const version = database.pragma('user_version', { simple: true });
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new Error(`Invalid SQLite schema version: ${String(version)}`);
  }
  return version;
}

function validateRegistry(migrations: readonly Migration[]): void {
  for (const [index, migration] of migrations.entries()) {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Invalid migration order: expected version ${expectedVersion}, received ${migration.version}`,
      );
    }
    if (migration.name.trim().length === 0) {
      throw new Error(`Migration ${migration.version} must have a name`);
    }
  }
}
