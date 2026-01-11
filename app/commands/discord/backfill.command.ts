/**
 * Discord Backfill History Command - Backfill message history from Discord
 *
 * Usage:
 *   bun cli discord:backfill                    # Default: 1 month, all guilds/channels
 *   bun cli discord:backfill --months=3         # 3 months of history
 *   bun cli discord:backfill --guild=123        # Specific guild only
 *   bun cli discord:backfill --channel=456      # Specific channel only
 *   bun cli discord:backfill --all              # All available history
 *   bun cli discord:backfill -i                 # Interactive mode
 */

import { Command } from '@core';
import { ChannelType, Client, GatewayIntentBits, type Message, type TextChannel } from 'discord.js';
import path from 'path';
import * as readline from 'readline';
import { initDatabase, messageExists, migrate } from '../../../core/database';
import { embed, initEmbedder, isEmbedderReady } from '../../../core/embedder';

const BATCH_SIZE = 100; // Discord API limit
const RATE_LIMIT_DELAY = 1000; // 1 second between batches to avoid rate limits

export default class BackfillCommand extends Command {
  static override signature = `
    discord:backfill
    {--i|interactive : Interactive mode - select guild/channel/options}
    {--guild= : Only backfill a specific guild ID}
    {--channel= : Only backfill a specific channel ID}
    {--months=1 : Number of months to backfill (default: 1)}
    {--all : Backfill all available history (ignores --months)}
    {--skip-embeddings : Skip generating embeddings (faster)}
    {--dry-run : Show what would be backfilled without actually doing it}
  `;

  static override description = 'Backfill message history from Discord into the database';

  private stats = {
    guilds: 0,
    channels: 0,
    messagesTotal: 0,
    messagesNew: 0,
    messagesSkipped: 0,
    embeddingsGenerated: 0,
    errors: 0,
  };

  private rl?: readline.Interface;

  async handle(): Promise<number> {
    const interactive = this.option('interactive') as boolean;
    let guildFilter = this.option('guild') as string | undefined;
    let channelFilter = this.option('channel') as string | undefined;
    let months = parseInt(this.option('months') as string, 10) || 1;
    let fetchAll = this.option('all') as boolean;
    let skipEmbeddings = this.option('skip-embeddings') as boolean;
    let dryRun = this.option('dry-run') as boolean;

    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      this.error('DISCORD_BOT_TOKEN not set in environment');
      return 1;
    }

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    });

    try {
      // Interactive mode - need to connect first to get guild/channel list
      if (interactive) {
        this.info('Connecting to Discord...');
        await client.login(token);
        await this.waitForReady(client);
        this.success(`Connected as ${client.user?.tag}\n`);

        const result = await this.runInteractiveMode(client);
        if (!result) {
          this.info('Cancelled.');
          return 0;
        }

        guildFilter = result.guildId;
        channelFilter = result.channelId;
        months = result.months;
        fetchAll = result.fetchAll;
        skipEmbeddings = result.skipEmbeddings;
        dryRun = result.dryRun;
      }

      // Calculate cutoff date
      const cutoffDate = fetchAll
        ? new Date(0) // Beginning of time
        : new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000);

      this.info(`Backfill Settings:`);
      this.info(`  Time range: ${fetchAll ? 'All history' : `Last ${months} month(s)`}`);
      this.info(`  Cutoff date: ${fetchAll ? 'None' : cutoffDate.toISOString()}`);
      this.info(`  Guild filter: ${guildFilter ?? 'All guilds'}`);
      this.info(`  Channel filter: ${channelFilter ?? 'All channels'}`);
      this.info(`  Generate embeddings: ${skipEmbeddings ? 'No' : 'Yes'}`);
      this.info(`  Dry run: ${dryRun ? 'Yes' : 'No'}`);
      console.log('');

      if (!dryRun) {
        // Initialize database
        this.info('Initializing database...');
        initDatabase();
        const migrationsDir = path.join(process.cwd(), 'migrations');
        await migrate(migrationsDir);

        // Initialize embedder if needed
        if (!skipEmbeddings) {
          this.info('Initializing embedding model...');
          await initEmbedder();
        }
      }

      // Connect if not already connected (non-interactive mode)
      if (!client.isReady()) {
        this.info('Connecting to Discord...');
        await client.login(token);
        await this.waitForReady(client);
        this.success(`Connected as ${client.user?.tag}`);
        console.log('');
      }

      // Get guilds to process
      const guilds = guildFilter ? client.guilds.cache.filter((g) => g.id === guildFilter) : client.guilds.cache;

      if (guilds.size === 0) {
        this.error(guildFilter ? `Guild not found: ${guildFilter}` : 'Bot is not in any guilds');
        return 1;
      }

      // Process each guild
      for (const guild of guilds.values()) {
        this.stats.guilds++;
        this.info(`\n📁 Processing guild: ${guild.name} (${guild.id})`);

        // Get text channels
        let channels = guild.channels.cache.filter(
          (ch) => ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement,
        );

        if (channelFilter) {
          channels = channels.filter((ch) => ch.id === channelFilter);
        }

        if (channels.size === 0) {
          this.warning('  No accessible text channels');
          continue;
        }

        // Process each channel
        for (const channel of channels.values()) {
          await this.processChannel(channel as TextChannel, guild.id, guild.name, cutoffDate, skipEmbeddings, dryRun);
        }
      }

      // Print summary
      console.log(`\n${'═'.repeat(50)}`);
      this.success('Backfill Complete!');
      console.log(`  Guilds processed: ${this.stats.guilds}`);
      console.log(`  Channels processed: ${this.stats.channels}`);
      console.log(`  Messages found: ${this.stats.messagesTotal}`);
      console.log(`  Messages stored: ${this.stats.messagesNew}`);
      console.log(`  Messages skipped (duplicates): ${this.stats.messagesSkipped}`);
      console.log(`  Embeddings generated: ${this.stats.embeddingsGenerated}`);
      if (this.stats.errors > 0) {
        console.log(`  Errors: ${this.stats.errors}`);
      }

      return 0;
    } catch (error) {
      this.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    } finally {
      client.destroy();
    }
  }

  private async processChannel(
    channel: TextChannel,
    guildId: string,
    guildName: string,
    cutoffDate: Date,
    skipEmbeddings: boolean,
    dryRun: boolean,
  ): Promise<void> {
    this.stats.channels++;
    this.info(`  📝 #${channel.name} (${channel.id})`);

    let lastMessageId: string | undefined;
    let channelMessages = 0;
    let channelNew = 0;
    let reachedCutoff = false;

    try {
      while (!reachedCutoff) {
        // Fetch messages
        const messages = await channel.messages.fetch({
          limit: BATCH_SIZE,
          ...(lastMessageId ? { before: lastMessageId } : {}),
        });

        if (messages.size === 0) break;

        for (const message of messages.values()) {
          // Check cutoff date
          if (message.createdAt < cutoffDate) {
            reachedCutoff = true;
            break;
          }

          channelMessages++;
          this.stats.messagesTotal++;

          if (dryRun) {
            channelNew++;
            this.stats.messagesNew++;
            continue;
          }

          // Check if already exists
          if (messageExists('discord', message.id)) {
            this.stats.messagesSkipped++;
            continue;
          }

          // Store message
          try {
            const messageId = await this.storeMessage(message, guildId, guildName);
            channelNew++;
            this.stats.messagesNew++;

            // Generate embedding for non-bot, non-trivial messages
            if (!skipEmbeddings && !message.author.bot && message.content.length >= 10 && isEmbedderReady()) {
              await this.generateEmbedding(messageId, message.content);
            }
          } catch (_error) {
            this.stats.errors++;
            // Continue processing other messages
          }
        }

        // Update last message ID for pagination
        lastMessageId = messages.last()?.id;

        // Rate limit protection
        if (messages.size === BATCH_SIZE) {
          await this.sleep(RATE_LIMIT_DELAY);
        }

        // Progress indicator
        process.stdout.write(`\r     Found ${channelMessages} messages, ${channelNew} new...`);
      }

      console.log(`\r     ✓ ${channelMessages} messages, ${channelNew} new${' '.repeat(20)}`);
    } catch (error) {
      this.stats.errors++;
      this.warning(`     ⚠ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async storeMessage(message: Message, guildId: string, _guildName: string): Promise<number> {
    const { insertMessage: insert } = await import('../../../core/database');

    return insert({
      platform: 'discord',
      platformMessageId: message.id,
      guildId: guildId,
      channelId: message.channel.id,
      userId: message.author.id,
      userName: message.author.displayName ?? message.author.username,
      content: message.content,
      isBot: message.author.bot,
      timestamp: message.createdAt,
    });
  }

  private async generateEmbedding(messageId: number, content: string): Promise<void> {
    try {
      const embedding = await embed(content);
      const { updateMessageEmbedding } = await import('../../../core/database');
      updateMessageEmbedding(messageId, embedding);
      this.stats.embeddingsGenerated++;
    } catch {
      // Silently skip embedding errors
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async waitForReady(client: Client): Promise<void> {
    if (client.isReady()) return;
    await new Promise<void>((resolve) => {
      client.once('clientReady', () => resolve());
    });
  }

  private async runInteractiveMode(client: Client): Promise<{
    guildId?: string;
    channelId?: string;
    months: number;
    fetchAll: boolean;
    skipEmbeddings: boolean;
    dryRun: boolean;
  } | null> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      // Step 1: Select Guild
      const guilds = Array.from(client.guilds.cache.values());
      console.log('\n📁 Select a guild:');
      console.log('  0) All guilds');
      for (let i = 0; i < guilds.length; i++) {
        const g = guilds[i];
        console.log(`  ${i + 1}) ${g.name} (${g.memberCount} members)`);
      }

      const guildChoice = await this.prompt(`\nEnter choice [0-${guilds.length}]: `);
      if (guildChoice === null) return null;

      const guildIndex = parseInt(guildChoice, 10);
      if (Number.isNaN(guildIndex) || guildIndex < 0 || guildIndex > guilds.length) {
        this.error('Invalid choice');
        return null;
      }

      const selectedGuild = guildIndex === 0 ? undefined : guilds[guildIndex - 1];
      let selectedChannel: TextChannel | undefined;

      // Step 2: Select Channel (if guild selected)
      if (selectedGuild) {
        const channels = Array.from(
          selectedGuild.channels.cache
            .filter((ch) => ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)
            .values(),
        ) as TextChannel[];

        channels.sort((a, b) => a.name.localeCompare(b.name));

        console.log(`\n📝 Select a channel in ${selectedGuild.name}:`);
        console.log('  0) All channels');
        for (let i = 0; i < channels.length; i++) {
          console.log(`  ${i + 1}) #${channels[i].name}`);
        }

        const channelChoice = await this.prompt(`\nEnter choice [0-${channels.length}]: `);
        if (channelChoice === null) return null;

        const channelIndex = parseInt(channelChoice, 10);
        if (Number.isNaN(channelIndex) || channelIndex < 0 || channelIndex > channels.length) {
          this.error('Invalid choice');
          return null;
        }

        selectedChannel = channelIndex === 0 ? undefined : channels[channelIndex - 1];
      }

      // Step 3: Time Range
      console.log('\n⏱️  Select time range:');
      console.log('  1) 1 month (default)');
      console.log('  2) 2 months');
      console.log('  3) 3 months');
      console.log('  4) 6 months');
      console.log('  5) 1 year');
      console.log('  6) All history');

      const timeChoice = await this.prompt('\nEnter choice [1-6]: ');
      if (timeChoice === null) return null;

      const timeOptions: { months: number; fetchAll: boolean }[] = [
        { months: 1, fetchAll: false },
        { months: 2, fetchAll: false },
        { months: 3, fetchAll: false },
        { months: 6, fetchAll: false },
        { months: 12, fetchAll: false },
        { months: 0, fetchAll: true },
      ];

      const timeIndex = parseInt(timeChoice, 10) - 1;
      const timeOption = timeOptions[timeIndex] ?? timeOptions[0]!;

      // Step 4: Embeddings
      const embedChoice = await this.prompt('\n🧠 Generate embeddings? [Y/n]: ');
      if (embedChoice === null) return null;
      const skipEmbeddings = embedChoice.toLowerCase() === 'n';

      // Step 5: Dry Run
      const dryChoice = await this.prompt('\n🔍 Dry run (preview only)? [y/N]: ');
      if (dryChoice === null) return null;
      const dryRun = dryChoice.toLowerCase() === 'y';

      // Confirm
      console.log(`\n${'─'.repeat(40)}`);
      console.log('Summary:');
      console.log(`  Guild: ${selectedGuild?.name ?? 'All guilds'}`);
      console.log(`  Channel: ${selectedChannel ? `#${selectedChannel.name}` : 'All channels'}`);
      console.log(`  Time: ${timeOption.fetchAll ? 'All history' : `${timeOption.months} month(s)`}`);
      console.log(`  Embeddings: ${skipEmbeddings ? 'No' : 'Yes'}`);
      console.log(`  Dry run: ${dryRun ? 'Yes' : 'No'}`);
      console.log('─'.repeat(40));

      const confirm = await this.prompt('\nProceed? [Y/n]: ');
      if (confirm === null || confirm.toLowerCase() === 'n') {
        return null;
      }

      return {
        guildId: selectedGuild?.id,
        channelId: selectedChannel?.id,
        months: timeOption.months,
        fetchAll: timeOption.fetchAll,
        skipEmbeddings,
        dryRun,
      };
    } finally {
      this.rl.close();
      this.rl = undefined;
    }
  }

  private prompt(question: string): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.rl) {
        resolve(null);
        return;
      }
      this.rl.question(question, (answer) => {
        resolve(answer);
      });
      // Handle Ctrl+C
      this.rl.once('close', () => resolve(null));
    });
  }
}
