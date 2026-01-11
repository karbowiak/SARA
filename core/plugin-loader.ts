/**
 * Plugin Loader - Loads plugins based on configuration
 *
 * Plugins are loaded from the filesystem but only if they're listed in config.
 * Access control is applied per-plugin based on config.accessGroups.
 */

import { Glob } from 'bun';
import type { BotConfig, FeatureAccess, PluginsConfig } from './config';
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
        } catch {
          // Not a valid plugin class, skip
        }
      }
    } catch (error) {
      logger.error(`Failed to load plugin from ${file}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
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
