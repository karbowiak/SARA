/**
 * Profile Generate Command - Manually generate user profiles
 *
 * Usage:
 *   bun cli.ts profile:generate --user 123456789 --guild 987654321
 *   bun cli.ts profile:generate -u 123456789 -g 987654321 --days 7
 *   bun cli.ts profile:generate -u 123456789 -g 987654321 --dry-run
 */

import { generateProfile } from '@app/services/profile-generator';
import { Command, loadBotConfig } from '@core';
import { getUserByPlatformId, initDatabase } from '@core/database';

export default class ProfileGenerateCommand extends Command {
  static override signature = `
    profile:generate
    {--u|user= : Platform user ID (required)}
    {--g|guild= : Guild ID (required)}
    {--d|days=2 : Days of messages to analyze}
    {--m|max-messages=10000 : Maximum messages to include}
    {--dry-run : Show prompt without saving}
  `;

  static override description = 'Generate a user profile from their recent messages';

  async handle(): Promise<number> {
    // 1. Get and validate options
    const platformUserId = this.option('user') as string;
    const guildId = this.option('guild') as string;
    const days = parseInt(this.option('days') as string, 10);
    const maxMessages = parseInt(this.option('max-messages') as string, 10);
    const dryRun = this.option('dry-run') as boolean;

    if (!platformUserId || !guildId) {
      this.error('Both --user and --guild are required');
      return 1;
    }

    // Initialize database and config
    initDatabase();
    await loadBotConfig();

    // 2. Look up user by platform ID
    this.info(`Looking up user ${platformUserId}...`);
    const user = getUserByPlatformId('discord', platformUserId);

    if (!user) {
      this.error(`User not found: ${platformUserId}`);
      return 1;
    }

    this.info(`Found user: ${user.username} (internal ID: ${user.id})`);

    // 3. Generate profile
    this.info(`Generating profile...`);
    this.info(`  Days: ${days}`);
    this.info(`  Max messages: ${maxMessages}`);
    this.info(`  Dry run: ${dryRun}`);

    const result = await generateProfile({
      userId: user.id,
      guildId,
      userName: user.display_name || user.username,
      days,
      maxMessages,
      dryRun,
    });

    // 4. Handle result
    if (!result.success) {
      this.error(`Failed to generate profile: ${result.error}`);
      if (result.prompt) {
        this.writeln('\n--- Prompt that would have been sent ---');
        this.writeln(result.prompt);
      }
      return 1;
    }

    if (dryRun) {
      this.success('Dry run complete. Prompt:');
      this.writeln('\n--- Prompt ---');
      this.writeln(result.prompt || 'No prompt generated');
      this.writeln('\n--- Messages analyzed ---');
      this.info(`${result.messagesAnalyzed} messages`);
      return 0;
    }

    // 5. Show generated profile
    this.success('Profile generated successfully!');
    this.writeln('');

    if (result.profile) {
      this.info('--- Generated Profile ---');
      this.writeln(`Summary: ${result.profile.summary || '(empty)'}`);
      this.writeln(`Personality: ${result.profile.personality || '(empty)'}`);
      this.writeln(`Interests: ${result.profile.interests || '(empty)'}`);
      this.writeln(`Facts: ${result.profile.facts || '(empty)'}`);
      this.writeln(`Messages analyzed: ${result.profile.messages_analyzed}`);
    }

    return 0;
  }
}
