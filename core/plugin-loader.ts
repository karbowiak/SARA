/**
 * Plugin Loader - Loads plugins based on configuration
 *
 * Plugins are loaded from the filesystem but only if they're listed in config.
 * Access control is applied per-plugin based on config.accessGroups.
 *
 * Message handlers are automatically wired to the eventbus.
 * Timer plugins are automatically started.
 */

import { Glob } from 'bun';
import type { BotConfig, FeatureAccess, PluginsConfig } from './config';
import { checkAccess } from './config';
import type { BotMessage, Logger, MessageHandlerPlugin, Plugin, PluginContext, TimerHandlerPlugin } from './types';
import { isMessageHandler, isPlugin, isTimerHandler } from './types';

export interface PluginLoaderOptions {
  /** Base directory to search for plugins */
  pluginsDir: string;
  /** Plugin context to pass to plugins */
  context: PluginContext;
  /** Logger */
  logger: Logger;
  /** Bot configuration (for filtering which plugins to load) */
  config?: BotConfig;
}

export interface LoadedPlugins {
  all: Plugin[];
  message: MessageHandlerPlugin[];
  timer: TimerHandlerPlugin[];
  /** Map of plugin ID to its access config */
  accessConfig: Map<string, FeatureAccess>;
  /** Timer intervals (for cleanup on shutdown) */
  timerIntervals: NodeJS.Timeout[];
}

/**
 * Load plugins based on configuration
 *
 * If config.plugins is defined, only plugins listed there are loaded.
 * If config.plugins is undefined, all discovered plugins are loaded (legacy behavior).
 */
export async function loadPlugins(options: PluginLoaderOptions): Promise<LoadedPlugins> {
  const { pluginsDir, context, logger, config } = options;

  const result: LoadedPlugins = {
    all: [],
    message: [],
    timer: [],
    accessConfig: new Map(),
    timerIntervals: [],
  };

  // Get list of plugins to load from config (undefined = load all)
  const pluginsToLoad: PluginsConfig | undefined = config?.plugins;

  // Find all plugin files
  const glob = new Glob('**/plugin.ts');
  const legacyGlob = new Glob('**/*.plugin.ts');
  const files: string[] = [];

  // Support both patterns: plugin.ts and *.plugin.ts
  for await (const file of glob.scan(pluginsDir)) {
    files.push(file);
  }
  for await (const file of legacyGlob.scan(pluginsDir)) {
    if (!files.includes(file)) {
      files.push(file);
    }
  }

  logger.info(`Found ${files.length} plugin files`);

  // Load each plugin
  for (const file of files) {
    const fullPath = `${pluginsDir}/${file}`;

    try {
      const module = await import(fullPath);

      // Look for default export or named exports that are plugin classes
      const exports = module.default ? [module.default] : Object.values(module);

      for (const exported of exports) {
        // Check if it's a class (function with prototype)
        if (typeof exported !== 'function') continue;

        try {
          const instance = new (exported as new () => Plugin)();

          if (!isPlugin(instance)) continue;

          // Check if this plugin should be loaded based on config
          if (pluginsToLoad !== undefined) {
            const accessConfig = pluginsToLoad[instance.id];
            if (accessConfig === undefined) {
              logger.debug(`Skipping plugin ${instance.id} - not in config`);
              continue;
            }
            // Store access config for later use
            result.accessConfig.set(instance.id, accessConfig);
          }

          // Load the plugin
          await instance.load(context);
          result.all.push(instance);

          // Categorize by type
          if (isMessageHandler(instance)) {
            result.message.push(instance);
          } else if (isTimerHandler(instance)) {
            result.timer.push(instance);
          }

          logger.info(`Loaded plugin: ${instance.id} (${instance.type})`);
        } catch (error) {
          // Not a valid plugin class, skip
          logger.debug(`Skipping export in ${file} - not a valid plugin`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      logger.error(`Failed to load plugin from ${file}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Sort message handlers by priority (higher first)
  result.message.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  // Wire message handlers to eventbus
  wireMessageHandlers(context, result, config, logger);

  // Start timer plugins
  result.timerIntervals = startTimerPlugins(context, result, logger);

  return result;
}

/**
 * Wire message handlers to the eventbus
 *
 * Subscribes to 'message:received' and dispatches to all matching handlers
 * with proper access control, scope checking, and error handling.
 */
function wireMessageHandlers(
  context: PluginContext,
  plugins: LoadedPlugins,
  config: BotConfig | undefined,
  logger: Logger,
): void {
  context.eventBus.on('message:received', async (message: BotMessage) => {
    for (const handler of plugins.message) {
      // Check all restrictions (scope, platform, guild)
      if (!shouldHandlerProcess(handler, message)) continue;

      // Check access control (skip for bots to avoid blocking logger)
      if (!message.author.isBot && config) {
        const accessConfig = plugins.accessConfig.get(handler.id);
        if (accessConfig) {
          const accessContext = {
            platform: message.platform,
            userId: message.author.id,
            roleIds: message.author.roleIds,
            guildId: message.guildId,
          };
          if (!checkAccess(accessConfig, accessContext, config)) {
            logger.debug(`User ${message.author.name} denied access to plugin ${handler.id}`, {
              userId: message.author.id,
              guildId: message.guildId,
            });
            continue;
          }
        }
      }

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
}

/**
 * Start timer plugins
 *
 * Returns array of interval handles stored in LoadedPlugins for cleanup.
 */
function startTimerPlugins(context: PluginContext, plugins: LoadedPlugins, logger: Logger): NodeJS.Timeout[] {
  const timerIntervals: NodeJS.Timeout[] = [];

  for (const timerPlugin of plugins.timer) {
    const intervalMs = timerPlugin.timerConfig.intervalMs;
    logger.info(`Starting timer plugin: ${timerPlugin.id} (every ${intervalMs / 1000}s)`);

    const runTick = async () => {
      try {
        await timerPlugin.tick(context);
      } catch (err) {
        logger.error(`Timer ${timerPlugin.id} tick error`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    // Run immediately if configured
    if (timerPlugin.timerConfig.runImmediately) {
      runTick();
    }

    // Schedule recurring ticks
    const interval = setInterval(runTick, intervalMs);
    timerIntervals.push(interval);
  }

  return timerIntervals;
}

/**
 * Check if a message handler should process a message based on its restrictions
 */
export function shouldHandlerProcess(handler: MessageHandlerPlugin, message: BotMessage): boolean {
  // Check scope (default to 'mention')
  const scope = handler.scope;
  if (scope !== 'all' && !message.mentionedBot) {
    return false;
  }

  // Check platform restriction
  if (handler.platforms && !handler.platforms.includes(message.platform)) {
    return false;
  }

  // Check guild restriction
  if (handler.guildIds && message.guildId) {
    if (!handler.guildIds.includes(message.guildId)) {
      return false;
    }
  }

  return true;
}

/**
 * Unload all plugins
 */
export async function unloadPlugins(plugins: Plugin[], logger: Logger): Promise<void> {
  for (const plugin of plugins) {
    try {
      await plugin.unload();
      logger.info(`Unloaded plugin: ${plugin.id}`);
    } catch (error) {
      logger.error(`Failed to unload plugin ${plugin.id}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
