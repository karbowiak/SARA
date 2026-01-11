# AI Tools

This document tracks the AI tools available to the bot and their implementation status.

## Tool Location

Tools are auto-discovered from `app/plugins/ai/tools/` directory. Any file matching `*.tool.ts` that exports a class implementing the `Tool` interface will be automatically loaded.

## Implemented Tools

| Tool | File | Description |
|------|------|-------------|
| **channel_history** | `channel-history.tool.ts` | Search/retrieve message history. Supports "recent" mode (last N messages) and "search" mode (semantic search) |
| **web_search** | `web-search.tool.ts` | Search the web using Tavily API. Requires `TAVILY_API_KEY` |
| **memory** | `memory.tool.ts` | Save/recall/forget user memories (preferences, facts, instructions, context). Guild-scoped with auto-deduplication |
| **last_seen** | `last-seen.tool.ts` | Look up user activity - when last seen, search by username, list recently active users |

## Slash Commands

| Command | Location | Description |
|---------|----------|-------------|
| **/ping** | `app/plugins/slash/ping/` | Simple ping/pong test command |
| **/demo** | `app/plugins/slash/demo/` | Demo all interaction types (autocomplete, buttons, selects, modals, embeds) |
| **/memory** | `app/plugins/slash/memory/` | User-facing memory management (list, delete, clear memories) |

## Tools to Port (from SARA v2)

### Priority 1 - Core

| Tool | Status | Description | Dependencies |
|------|--------|-------------|--------------|
| **MemoryTools** | ✅ Done | Save/update user preferences and context to persistent storage | Database schema for memories |
| **ThinkingTool** | 🔲 Todo | Escalate complex problems to a reasoning model (o1-mini) with extended thinking | OpenRouter API |
| **ImageGenerationTool** | 🔲 Todo | Generate images from text prompts using OpenRouter | OpenRouter API |

### Priority 2 - Utility

| Tool | Status | Description | Dependencies |
|------|--------|-------------|--------------|
| **CurrencyConversionTool** | 🔲 Todo | Convert between currencies using real-time exchange rates | exchangerate-api.com |
| **ReminderTool** | 🔲 Todo | Create/list/cancel reminders delivered via DM | Timer infrastructure, RemindersService |
| **SearchKnowledgeTool** | 🔲 Todo | Retrieve knowledge base entries by ID | Knowledge base schema |

## Skipped Tools

| Tool | Reason |
|------|--------|
| **MathTool** | LLMs handle math well enough |
| **PingTool** | Security risk (shell exec), niche use case |
| **ROAStatusTool** | Game-specific, not portable |
| **StreamAlertTool** | Complex, requires stream monitoring service |

## Creating a New Tool

1. Create a file in `app/plugins/ai/tools/` named `my-tool.tool.ts`
2. Export a class implementing the `Tool` interface:

```typescript
import type { Tool, ToolMetadata, ToolSchema, ToolExecutionContext, ToolResult } from '@core';

export class MyTool implements Tool {
  readonly metadata: ToolMetadata = {
    name: 'my_tool',
    description: 'What this tool does',
    version: '1.0.0',
    author: 'Your Name',
    keywords: ['keyword1', 'keyword2'],
    category: 'utility', // or 'information', 'creative', etc.
    priority: 5,
  };

  readonly schema: ToolSchema = {
    type: 'function',
    name: 'my_tool',
    description: 'Detailed description for the AI',
    parameters: {
      type: 'object',
      properties: {
        param1: {
          type: 'string',
          description: 'What this parameter does',
        },
      },
      required: ['param1'],
      additionalProperties: false,
    },
    strict: true,
  };

  // Optional: Return false to skip loading (e.g., missing API key)
  validate(): boolean {
    return !!process.env.MY_API_KEY;
  }

  async execute(args: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    const params = args as { param1: string };
    
    try {
      // Do the work...
      return {
        success: true,
        data: { result: 'whatever' },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'execution_error',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
```

3. Restart the bot - the tool will be auto-discovered and registered.

## Tool Interface Reference

```typescript
interface Tool {
  metadata: ToolMetadata;
  schema: ToolSchema;
  validate?(): boolean;
  execute(args: unknown, context: ToolExecutionContext): Promise<ToolResult>;
}

interface ToolExecutionContext {
  message: BotMessage;
  user: BotUser;
  channel: BotChannel;
  logger: Logger;
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: {
    type: string;
    message: string;
    retryable?: boolean;
  };
}
```
