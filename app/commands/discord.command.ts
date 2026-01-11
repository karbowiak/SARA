import {
  Command,
  createEventBus,
  getBotConfig,
  type Logger,
  loadBotConfig,
  loadPlugins,
  type PluginContext,
  shouldHandlerProcess,
  unloadPlugins,
} from '@core';
import path from 'path';
import { DiscordAdapter } from '../../bot/discord/adapter';
import { initDatabase, migrate } from '../../core/database';
import { initEmbedder } from '../../core/embedder';

export default class DiscordCommand extends Command {
  static override signature = `
    discord
    {--c|config=config/config.ts : Path to config file}
    {--d|debug : Enable debug logging}
    {--skip-embedder : Skip loading the embedding model}
  `;

  static override description = 'Start the Discord bot';

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

    // Validate required tokens
    if (!config.tokens.discord) {
      this.error('Discord token not set in config.tokens.discord');
      return 1;
    }
    if (!config.tokens.openrouter) {
      this.error('OpenRouter API key not set in config.tokens.openrouter');
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

    // Load plugins from app/plugins (filtered by config.plugins)
    const pluginsDir = path.join(import.meta.dir, '../plugins');
    const plugins = await loadPlugins({ pluginsDir, context, logger, config });

    // Sort message handlers by priority (higher first)
    const sortedMessageHandlers = [...plugins.message].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    this.success(`Loaded ${plugins.all.length} plugins (${plugins.message.length} message handlers)`);

    // Wire up message handlers
    eventBus.on('message:received', async (message) => {
      for (const handler of sortedMessageHandlers) {
        // Check all restrictions (scope, platform, guild)
        if (!shouldHandlerProcess(handler, message)) continue;

        // Check plugin's own shouldHandle logic
        if (!handler.shouldHandle(message)) continue;

        try {
          await handler.handle(message, context);
        } catch (error) {
          logger.error(`Plugin ${handler.id} error`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });

    // Create and connect Discord adapter
    const adapter = new DiscordAdapter({ token: config.tokens.discord, eventBus, logger });

    // Register slash commands when bot is ready
    eventBus.once('bot:ready', async () => {
      await adapter.registerSlashCommands();
    });

    this.info('Connecting to Discord...');
    await adapter.connect(config.tokens.discord);

    // Keep running until interrupted
    this.info('Bot is running. Press Ctrl+C to stop.');

    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        this.info('Shutting down...');
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
