/**
 * Tool Loader - Loads AI tools based on configuration
 *
 * Tools are loaded from the filesystem but only if they're listed in config.
 * Access control is applied per-tool based on config.accessGroups.
 */

import { Glob } from 'bun';
import type { BotConfig, FeatureAccess, ToolsConfig } from './config';
import type { Logger, Tool } from './types';

export interface ToolLoaderOptions {
  /** Base directory to search for tools */
  toolsDir: string;
  /** Logger */
  logger: Logger;
  /** Bot configuration (for filtering which tools to load) */
  config?: BotConfig;
}

export interface LoadedTools {
  /** All loaded tools */
  all: Tool[];
  /** Map of tool name to its access config */
  accessConfig: Map<string, FeatureAccess>;
}

/**
 * Type guard to check if an object is a valid Tool
 */
function isTool(obj: unknown): obj is Tool {
  if (!obj || typeof obj !== 'object') return false;
  const tool = obj as Record<string, unknown>;

  return (
    typeof tool.metadata === 'object' &&
    tool.metadata !== null &&
    typeof (tool.metadata as Record<string, unknown>).name === 'string' &&
    typeof tool.schema === 'object' &&
    tool.schema !== null &&
    typeof tool.execute === 'function'
  );
}

/**
 * Load tools based on configuration
 *
 * If config.tools is defined, only tools listed there are loaded.
 * If config.tools is undefined, all discovered tools are loaded (legacy behavior).
 */
export async function loadTools(options: ToolLoaderOptions): Promise<LoadedTools> {
  const { toolsDir, logger, config } = options;

  const result: LoadedTools = {
    all: [],
    accessConfig: new Map(),
  };

  // Get list of tools to load from config (undefined = load all)
  const toolsToLoad: ToolsConfig | undefined = config?.tools;

  // Find all tool files
  const glob = new Glob('**/*.tool.ts');
  const files: string[] = [];

  for await (const file of glob.scan(toolsDir)) {
    files.push(file);
  }

  if (files.length === 0) {
    logger.debug('No tool files found', { toolsDir });
    return result;
  }

  logger.debug(`Found ${files.length} tool file(s)`, { files });

  // Load each tool
  for (const file of files) {
    const fullPath = `${toolsDir}/${file}`;

    try {
      const module = await import(fullPath);

      // Look for default export or named exports that are tool classes
      const exports = module.default ? [module.default] : Object.values(module);

      for (const exported of exports) {
        // Check if it's a class (function with prototype)
        if (typeof exported !== 'function') continue;

        try {
          const instance = new (exported as new () => Tool)();

          if (!isTool(instance)) continue;

          const toolName = instance.metadata.name;

          // Check if this tool should be loaded based on config
          if (toolsToLoad !== undefined) {
            const accessConfig = toolsToLoad[toolName];
            if (accessConfig === undefined) {
              logger.debug(`Skipping tool ${toolName} - not in config`);
              continue;
            }
            // Store access config for later use
            result.accessConfig.set(toolName, accessConfig);
          }

          // Check if tool has validation and if it passes
          if (typeof instance.validate === 'function' && !instance.validate()) {
            logger.warn(`Tool ${toolName} validation failed - skipping`, {
              tool: toolName,
              hint: 'Check required environment variables or API keys',
            });
            continue;
          }

          result.all.push(instance);
          logger.debug(`Loaded tool: ${toolName}`, {
            tool: toolName,
            category: instance.metadata.category,
          });
        } catch (_err) {
          // Not a valid tool class, skip silently
        }
      }
    } catch (error) {
      logger.error(`Failed to load tool from ${file}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * Get tool by name from a list of tools
 */
export function getToolByName(tools: Tool[], name: string): Tool | undefined {
  return tools.find((t) => t.schema.name === name || t.metadata.name === name);
}
