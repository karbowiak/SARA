/**
 * Slack CLI Command - Start the Slack bot
 */

import path from 'node:path';
import { SlackAdapter } from '@bot/slack/adapter';
import {
  Command,
  createEventBus,
  getBotConfig,
  type Logger,
  loadBotConfig,
  loadPlugins,
  type PluginContext,
  unloadPlugins,
} from '@core';
import { initDatabase, migrate } from '@core/database';
import { initEmbedder } from '@core/embedder';

export default class SlackCommand extends Command {
  static override signature = `
    slack
    {--c|config=config/config.slack.ts : Path to config file}
    {--d|debug : Enable debug logging}
    {--skip-embedder : Skip loading the embedding model}
  `;

  static override description = 'Start the Slack bot';

  async handle(): Promise<number> {
    const configPath = this.option('config') as string;
    const debug = this.option('debug') as boolean;
    const skipEmbedder = this.option('skip-embedder') as boolean;

    // Load configuration
    const fullConfigPath = path.resolve(process.cwd(), configPath);
    this.info(`Loading config from ${configPath}...`);

    try {
      await loadBotConfig(fullConfigPath);
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
      return 1;
    }

    const config = getBotConfig();

    // Validate Slack tokens
    if (!config.tokens.slack?.botToken) {
      this.error('Slack bot token not set in config.tokens.slack.botToken');
      return 1;
    }

    if (!config.tokens.slack?.appToken) {
      this.error('Slack app token not set in config.tokens.slack.appToken');
      return 1;
    }

    // Create logger that uses CLI output
    const logger: Logger = {
      debug: (msg, ctx) => debug && this.comment(`[DEBUG] ${msg} ${ctx ? JSON.stringify(ctx) : ''}`),
      info: (msg, ctx) => this.info(`${msg} ${ctx ? JSON.stringify(ctx) : ''}`),
      warn: (msg, ctx) => this.warning(`${msg} ${ctx ? JSON.stringify(ctx) : ''}`),
      error: (msg, ctx) => this.error(`${msg} ${ctx ? JSON.stringify(ctx) : ''}`),
    };

    this.success(`Bot: ${config.bot.name} (${config.bot.identity ?? config.bot.name})`);

    // Initialize database and run migrations
    this.info('Initializing database...');
    initDatabase();
    const migrationsDir = path.join(process.cwd(), 'migrations');
    await migrate(migrationsDir);

    // Initialize embedding model (unless skipped)
    if (!skipEmbedder) {
      this.info('Initializing embedding model...');
      await initEmbedder();
    }

    // Create EventBus
    const eventBus = createEventBus({ debug });

    // Create plugin context
    const context: PluginContext = { eventBus, logger };

    // Load plugins (auto-wires to eventBus and starts timers)
    this.info('Loading plugins...');
    const pluginsDir = path.join(process.cwd(), 'app', 'plugins');
    const plugins = await loadPlugins({ pluginsDir, context, logger, config });

    this.success(`Loaded ${plugins.all.length} plugins (${plugins.message.length} message handlers)`);

    // Create Slack adapter
    this.info('Creating Slack adapter...');
    const adapter = new SlackAdapter({
      botToken: config.tokens.slack.botToken,
      appToken: config.tokens.slack.appToken,
      eventBus,
      logger,
    });

    // Connect to Slack
    this.info('Connecting to Slack...');
    await adapter.connect();
    this.success(`${config.bot.name} is online on Slack! 🚀`);

    // Keep running until interrupted
    this.info('Bot is running. Press Ctrl+C to stop.');

    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        this.info('Shutting down...');

        // Stop all timer intervals
        for (const interval of plugins.timerIntervals) {
          clearInterval(interval);
        }

        await unloadPlugins(plugins.all, logger);
        await adapter.disconnect();
        resolve();
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });

    return 0;
  }
}
