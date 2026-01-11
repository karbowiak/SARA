/**
 * Database Commands - Manage database migrations
 *
 * Usage:
 *   bun cli db:migrate   - Run pending migrations
 *   bun cli db:status    - Show migration status
 *   bun cli db:rollback  - Rollback last migration
 *   bun cli db:reset     - Rollback all migrations
 */

import { Command } from '@core';
import { closeDatabase, getMigrationStatus, migrate, reset, rollback } from '../../core/database';

export class DbMigrateCommand extends Command {
  static override signature = 'db:migrate';
  static override description = 'Run all pending database migrations';

  async handle(): Promise<number> {
    try {
      this.info('Running migrations...');

      const results = await migrate();

      if (results.length === 0) {
        this.info('No pending migrations.');
      } else {
        for (const record of results) {
          this.success(`✓ Migrated: ${record.version}_${record.name}`);
        }
        this.success(`\nRan ${results.length} migration(s).`);
      }

      closeDatabase();
      return 0;
    } catch (error) {
      this.error(`Migration failed: ${error instanceof Error ? error.message : error}`);
      closeDatabase();
      return 1;
    }
  }
}

export class DbStatusCommand extends Command {
  static override signature = 'db:status';
  static override description = 'Show database migration status';

  async handle(): Promise<number> {
    try {
      const status = await getMigrationStatus();

      this.info(`Current version: ${status.current}`);
      console.log('');

      if (status.applied.length > 0) {
        this.info('Applied migrations:');
        for (const record of status.applied) {
          const date = new Date(record.applied_at).toISOString();
          console.log(`  ✓ ${record.version}_${record.name} (${date})`);
        }
      } else {
        this.comment('No migrations applied yet.');
      }

      console.log('');

      if (status.pending.length > 0) {
        this.warning('Pending migrations:');
        for (const migration of status.pending) {
          console.log(`  ○ ${migration.version}_${migration.name}`);
        }
      } else {
        this.success('All migrations are up to date.');
      }

      closeDatabase();
      return 0;
    } catch (error) {
      this.error(`Failed to get status: ${error instanceof Error ? error.message : error}`);
      closeDatabase();
      return 1;
    }
  }
}

export class DbRollbackCommand extends Command {
  static override signature = 'db:rollback';
  static override description = 'Rollback the last database migration';

  async handle(): Promise<number> {
    try {
      this.info('Rolling back last migration...');

      const result = await rollback();

      if (!result) {
        this.info('No migrations to rollback.');
      } else {
        this.success(`✓ Rolled back: ${result.version}_${result.name}`);
      }

      closeDatabase();
      return 0;
    } catch (error) {
      this.error(`Rollback failed: ${error instanceof Error ? error.message : error}`);
      closeDatabase();
      return 1;
    }
  }
}

export class DbResetCommand extends Command {
  static override signature = 'db:reset {--force : Skip confirmation}';
  static override description = 'Rollback all database migrations (destructive!)';

  async handle(): Promise<number> {
    const force = this.option('force') as boolean;

    if (!force) {
      this.warning('⚠️  This will rollback ALL migrations and delete all data!');
      this.comment('Use --force to confirm.');
      return 1;
    }

    try {
      this.info('Rolling back all migrations...');

      const results = await reset();

      if (results.length === 0) {
        this.info('No migrations to rollback.');
      } else {
        for (const record of results) {
          this.success(`✓ Rolled back: ${record.version}_${record.name}`);
        }
        this.success(`\nRolled back ${results.length} migration(s).`);
      }

      closeDatabase();
      return 0;
    } catch (error) {
      this.error(`Reset failed: ${error instanceof Error ? error.message : error}`);
      closeDatabase();
      return 1;
    }
  }
}

// Export default for auto-discovery (the first command)
export default DbMigrateCommand;
