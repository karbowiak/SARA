/**
 * Tool Loader - Auto-discovers and loads AI tools from the filesystem
 */

import { Glob } from 'bun';
import type { Logger, Tool } from './types';

export interface ToolLoaderOptions {
  /** Base directory to search for tools */
  toolsDir: string;
  /** Logger */
  logger: Logger;
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
 * Load all tools from the tools directory
 *
 * Discovers files matching *.tool.ts pattern and instantiates Tool classes.
 * Tools with a validate() method that returns false are skipped (e.g., missing API keys).
 */
export async function loadTools(options: ToolLoaderOptions): Promise<Tool[]> {
  const { toolsDir, logger } = options;
  const tools: Tool[] = [];

  // Find all tool files
  const glob = new Glob('**/*.tool.ts');
  const files: string[] = [];

  for await (const file of glob.scan(toolsDir)) {
    files.push(file);
  }

  if (files.length === 0) {
    logger.debug('No tool files found', { toolsDir });
    return tools;
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

          // Check if tool has validation and if it passes
          if (typeof instance.validate === 'function' && !instance.validate()) {
            logger.warn(`Tool ${instance.metadata.name} validation failed - skipping`, {
              tool: instance.metadata.name,
              hint: 'Check required environment variables',
            });
            continue;
          }

          tools.push(instance);
          logger.debug(`Loaded tool: ${instance.metadata.name}`, {
            tool: instance.metadata.name,
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

  return tools;
}

/**
 * Get tool by name from a list of tools
 */
export function getToolByName(tools: Tool[], name: string): Tool | undefined {
  return tools.find((t) => t.schema.name === name || t.metadata.name === name);
}
