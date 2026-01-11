/**
 * Database Migration System
 *
 * Handles running and tracking database migrations with up/down support.
 */

import fs from 'fs';
import path from 'path';
import { getDatabase } from './client';

export interface Migration {
  /** Migration version number */
  version: number;
  /** Migration name */
  name: string;
  /** Apply the migration */
  up: (db: ReturnType<typeof getDatabase>) => void;
  /** Rollback the migration */
  down: (db: ReturnType<typeof getDatabase>) => void;
}

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: number;
}

export interface MigrationStatus {
  applied: MigrationRecord[];
  pending: Migration[];
  current: number;
}

/**
 * Initialize the migrations table
 */
function ensureMigrationsTable(db: ReturnType<typeof getDatabase>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);
}

/**
 * Get all applied migrations
 */
function getAppliedMigrations(db: ReturnType<typeof getDatabase>): MigrationRecord[] {
  const stmt = db.prepare('SELECT version, name, applied_at FROM _migrations ORDER BY version ASC');
  return stmt.all() as MigrationRecord[];
}

/**
 * Load all migration files from the migrations directory
 */
export async function loadMigrations(migrationsDir?: string): Promise<Migration[]> {
  const dir = migrationsDir ?? path.join(process.cwd(), 'migrations');

  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && /^\d+_/.test(f))
    .sort();

  const migrations: Migration[] = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const mod = await import(filePath);

    // Extract version from filename (e.g., "001_create_messages.ts" -> 1)
    const versionStr = file.split('_')[0];
    if (!versionStr) {
      throw new Error(`Invalid migration filename: ${file}`);
    }
    const version = parseInt(versionStr, 10);
    const name = file.replace(/^\d+_/, '').replace('.ts', '');

    if (!mod.up || !mod.down) {
      throw new Error(`Migration ${file} must export 'up' and 'down' functions`);
    }

    migrations.push({
      version,
      name,
      up: mod.up,
      down: mod.down,
    });
  }

  return migrations.sort((a, b) => a.version - b.version);
}

/**
 * Get migration status
 */
export async function getMigrationStatus(migrationsDir?: string): Promise<MigrationStatus> {
  const db = getDatabase();
  ensureMigrationsTable(db);

  const applied = getAppliedMigrations(db);
  const appliedVersions = new Set(applied.map((m) => m.version));

  const allMigrations = await loadMigrations(migrationsDir);
  const pending = allMigrations.filter((m) => !appliedVersions.has(m.version));

  const current = applied.length > 0 ? Math.max(...applied.map((m) => m.version)) : 0;

  return { applied, pending, current };
}

/**
 * Run all pending migrations
 */
export async function migrate(migrationsDir?: string): Promise<MigrationRecord[]> {
  const db = getDatabase();
  ensureMigrationsTable(db);

  const status = await getMigrationStatus(migrationsDir);
  const results: MigrationRecord[] = [];

  for (const migration of status.pending) {
    const record: MigrationRecord = {
      version: migration.version,
      name: migration.name,
      applied_at: Date.now(),
    };

    db.transaction(() => {
      // Run the migration
      migration.up(db);

      // Record the migration
      const stmt = db.prepare('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)');
      stmt.run(record.version, record.name, record.applied_at);
    })();

    results.push(record);
  }

  return results;
}

/**
 * Rollback the last migration
 */
export async function rollback(migrationsDir?: string): Promise<MigrationRecord | null> {
  const db = getDatabase();
  ensureMigrationsTable(db);

  const applied = getAppliedMigrations(db);
  if (applied.length === 0) {
    return null;
  }

  const last = applied[applied.length - 1];
  if (!last) {
    return null;
  }

  const allMigrations = await loadMigrations(migrationsDir);
  const migration = allMigrations.find((m) => m.version === last.version);

  if (!migration) {
    throw new Error(`Migration ${last.version}_${last.name} not found in migrations directory`);
  }

  db.transaction(() => {
    // Run the down migration
    migration.down(db);

    // Remove the migration record
    const stmt = db.prepare('DELETE FROM _migrations WHERE version = ?');
    stmt.run(last.version);
  })();

  return last;
}

/**
 * Rollback all migrations
 */
export async function reset(migrationsDir?: string): Promise<MigrationRecord[]> {
  const results: MigrationRecord[] = [];

  let rolled = await rollback(migrationsDir);
  while (rolled) {
    results.push(rolled);
    rolled = await rollback(migrationsDir);
  }

  return results;
}
