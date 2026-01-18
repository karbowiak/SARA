# Bot Development Guide

This document describes how to develop plugins, tools, and commands for this bot framework.

## Project Structure

```
bot/
├── app/
│   ├── commands/            # CLI commands (*.command.ts)
│   └── plugins/
│       ├── ai/              # AI response handler + tools
│       │   ├── ai.plugin.ts # Main AI message handler
│       │   └── tools/       # Auto-discovered AI tools (*.tool.ts)
│       ├── message/         # Message handler plugins (*.plugin.ts)
│       ├── slash/           # Slash command plugins
│       │   └── <command>/   # Each command gets its own folder
│       │       ├── plugin.ts
│       │       └── command.ts
│       └── timers/          # Timer plugins (*.plugin.ts)
├── bot/
│   └── discord/             # Platform adapter (Discord-specific)
├── config/                  # Configuration files
│   ├── config.example.ts    # Example config (copy to config.ts)
│   └── config.ts            # Your config (gitignored)
├── core/                    # Framework core (platform-agnostic)
│   ├── types/               # Type definitions
│   └── database/            # Database repositories
├── migrations/              # Database migrations
└── tests/                   # Test files (*.test.ts)
```

## Configuration

Configuration is stored in `config/config.ts`. Copy `config.example.ts` to get started:

```bash
cp config/config.example.ts config/config.ts
# Edit config/config.ts with your tokens and settings
```

**Multiple Configs:** Create `config/config-mybot.ts` for different bot personalities:
```bash
bun cli.ts discord --config config/config-sara.ts
bun cli.ts discord --config config/config-tim.ts
```

### Config Structure

```typescript
import type { BotConfig } from '@core';

const config: BotConfig = {
  // API tokens (required)
  tokens: {
    discord: 'YOUR_DISCORD_TOKEN',
    openrouter: 'YOUR_OPENROUTER_KEY',
    tavily: 'YOUR_TAVILY_KEY', // optional, for web search
  },
  
  // Bot identity
  bot: {
    name: 'MyBot',
    identity: 'MyBot',       // Name used in prompts
    description: '...',
    developer: 'Your Name',
  },
  
  // AI settings
  ai: {
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
    temperature: 0.7,
    maxTokens: 4096,
  },
  
  // Personality (system prompt)
  personality: {
    identity: 'You are a helpful assistant...',
    traits: '...',
    guidelines: ['...'],
    tone: ['friendly', 'helpful'],
    restrictions: ['Never do X'],
    customInstructions: '...',
  },
  
  // Access control (optional)
  accessGroups: {
    admin: {
      discord: ['ROLE_ID_1', 'ROLE_ID_2'],
    },
    moderator: {
      discord: ['ROLE_ID_3'],
    },
  },
  
  // Plugin configuration (optional - loads all if omitted)
  plugins: {
    memory: {},                         // Everyone can use
    imagine: {},                        // Everyone can use
    admin: { users: ['123456789'] },    // Specific user only
    serveronly: { guilds: ['111222'] }, // Specific guild only
  },
  
  // Tool configuration (optional - loads all if omitted)
  tools: {
    memory: {},                         // Everyone can use
    'web-search': {},                   // Everyone can use
    'channel-history': { groups: ['admin', 'moderator'] },
    'dangerous-tool': { roles: ['789'], users: ['123'] }, // Role OR user
  },
};

export default config;
```

### Access Control

The `accessGroups` section maps group names to platform role IDs. The `plugins` and `tools` sections specify access rules:

**Access Rule Types (OR'd together - any match grants access):**
- **Empty object `{}`** = Everyone can use
- **`{ groups: ['admin'] }`** = Users in the admin group (from accessGroups)
- **`{ users: ['123456789'] }`** = Specific user IDs
- **`{ roles: ['987654321'] }`** = Specific role IDs (platform-specific)
- **`{ guilds: ['111222333'] }`** = Only in specific guilds/servers
- **Combined**: `{ groups: ['admin'], users: ['123'] }` = Admin group OR specific user
- **Not listed** = Not loaded at all

User roles are automatically resolved and cached (24h TTL) when they send messages.

---

## Bun Conventions

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install`
- Use `bun run <script>` instead of `npm run <script>`

### Path Aliases

Use path aliases instead of relative imports:
- `@core` → `./core`
- `@app` → `./app`
- `@bot` → `./bot`

```typescript
// ✅ Good
import { type BotMessage } from '@core';
import { getMemories } from '@core/database';

// ❌ Bad
import { type BotMessage } from '../../../core';
```

---

## Plugin Types

All plugins implement a base interface with `id`, `type`, `load()`, and `unload()`.

**Important:** Plugin IDs should be simple names like `memory`, `imagine`, `knowledge` - not `memory-command` or `knowledge-plugin`.

### 1. Message Handler Plugin

Reacts to chat messages. Located in `app/plugins/message/`.

```typescript
// app/plugins/message/example.plugin.ts
import {
  type MessageHandlerPlugin,
  type PluginContext,
  type BotMessage,
} from '@core';

export class ExamplePlugin implements MessageHandlerPlugin {
  readonly id = 'example';
  readonly type = 'message' as const;
  
  // 'mention' = only when bot is @mentioned (default)
  // 'all' = every message (use sparingly)
  readonly scope = 'mention' as const;
  
  // Higher priority runs first (default: 0)
  readonly priority = 0;
  
  // Optional: restrict to platforms
  readonly platforms = ['discord'] as const;

  private context?: PluginContext;

  async load(context: PluginContext): Promise<void> {
    this.context = context;
    context.logger.info('ExamplePlugin loaded');
  }

  async unload(): Promise<void> {
    this.context?.logger.info('ExamplePlugin unloaded');
  }

  // Return true if this handler should process the message
  shouldHandle(message: BotMessage): boolean {
    return message.content.includes('hello');
  }

  // Handle the message
  async handle(message: BotMessage, context: PluginContext): Promise<void> {
    context.eventBus.emit('message:send', {
      channelId: message.channelId,
      content: 'Hello back!',
      replyTo: message.id,
    });
  }
}
```

### 2. Slash Command Plugin

Handles slash commands. Located in `app/plugins/slash/<command>/`.

**Structure:**
- `command.ts` - Command definition
- `plugin.ts` - Command handler

```typescript
// app/plugins/slash/greet/command.ts
import type { SlashCommandDefinition } from '@core';

export const greetCommand: SlashCommandDefinition = {
  name: 'greet',
  description: 'Greet someone',
  guildOnly: true, // Optional: server-only
  subcommands: [
    {
      name: 'user',
      description: 'Greet a user',
      options: [
        {
          name: 'target',
          description: 'Who to greet',
          type: 'user',
          required: true,
        },
      ],
    },
    {
      name: 'everyone',
      description: 'Greet the whole channel',
    },
  ],
  // Or use options instead of subcommands for simple commands:
  // options: [
  //   { name: 'name', description: 'Name to greet', type: 'string', required: true }
  // ],
};
```

```typescript
// app/plugins/slash/greet/plugin.ts
import {
  type CommandHandlerPlugin,
  type PluginContext,
  type CommandInvocation,
  type AutocompleteRequest,
  type ButtonInteraction,
  registerCommand,
  unregisterCommand,
} from '@core';
import { greetCommand } from './command';

export class GreetCommandPlugin implements CommandHandlerPlugin {
  readonly id = 'greet';  // Simple name, not 'greet-command'
  readonly type = 'command' as const;
  readonly commands = ['greet'];

  private context?: PluginContext;

  async load(context: PluginContext): Promise<void> {
    this.context = context;
    
    // Register command with Discord
    registerCommand(greetCommand, this.id);
    
    // Subscribe to command events
    context.eventBus.on('command:received', this.handleCommand.bind(this));
    
    // Optional: handle autocomplete, buttons, selects, modals
    context.eventBus.on('command:autocomplete', this.handleAutocomplete.bind(this));
    context.eventBus.on('interaction:button', this.handleButton.bind(this));
    
    context.logger.info('GreetCommandPlugin loaded');
  }

  async unload(): Promise<void> {
    unregisterCommand('greet');
    this.context?.logger.info('GreetCommandPlugin unloaded');
  }

  private async handleCommand(invocation: CommandInvocation): Promise<void> {
    if (invocation.commandName !== 'greet') return;

    // Use invocation.subcommand (string) and invocation.args (Record<string, unknown>)
    // NOT Discord.js style options.getSubcommand() or options.getString()
    const { subcommand, args } = invocation;
    
    switch (subcommand) {
      case 'user': {
        // Args are keyed by option name
        const targetId = args.target as string;
        await invocation.reply({
          content: `Hello, <@${targetId}>!`,
          ephemeral: true, // Only visible to command user
        });
        break;
      }
      case 'everyone':
        await invocation.reply({ content: 'Hello everyone!' });
        break;
      default:
        await invocation.reply({
          content: 'Unknown subcommand',
          ephemeral: true,
        });
    }
  }

  private async handleAutocomplete(request: AutocompleteRequest): Promise<void> {
    if (request.commandName !== 'greet') return;
    
    // Filter based on what the user is typing
    const search = request.focusedOption.value.toLowerCase();
    
    // Return autocomplete choices
    await request.respond([
      { name: 'Option 1', value: 'opt1' },
      { name: 'Option 2', value: 'opt2' },
    ].filter(c => c.name.toLowerCase().includes(search)));
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    // Filter by customId prefix to only handle your buttons
    if (!interaction.customId.startsWith('greet_')) return;
    
    await interaction.reply({ content: 'Button clicked!', ephemeral: true });
  }
}

export default GreetCommandPlugin;
```

### Interaction Patterns (Autocomplete, Buttons, Selects, Modals, Embeds)

Use these patterns as a template when building interactive slash commands:

- **Autocomplete:** listen to `command:autocomplete` and return filtered choices
- **Buttons:** prefix `customId` (e.g., `mycmd_`) and filter by prefix
- **Select menus:** filter on `customId` and respond with `interaction.reply(...)`
- **Modals:** call `invocation.showModal(...)` then handle `interaction:modal`
- **Embeds:** include `embeds: [BotEmbed]` in command responses; attach components below

Minimal wiring (within `load()`):
```typescript
context.eventBus.on('command:received', this.handleCommand.bind(this));
context.eventBus.on('command:autocomplete', this.handleAutocomplete.bind(this));
context.eventBus.on('interaction:button', this.handleButton.bind(this));
context.eventBus.on('interaction:select', this.handleSelect.bind(this));
context.eventBus.on('interaction:modal', this.handleModal.bind(this));
```

Key conventions:
- Use stable `customId` prefixes (`mycmd_*`) to avoid collisions.
- Prefer `interaction.deferUpdate()` for button clicks that only change UI state.
- Keep response payloads platform‑agnostic (use `BotEmbed`, `BotButton`, `BotSelect`).

**CommandInvocation Properties:**
- `commandName: string` - The command name (e.g., 'greet')
- `subcommand?: string` - The subcommand name if any
- `subcommandGroup?: string` - The subcommand group if any
- `args: Record<string, unknown>` - Option values keyed by option name
- `user: BotUser` - The user who ran the command
- `channel: BotChannel` - The channel where command was run
- `guildId?: string` - The guild ID (undefined in DMs)
- `platform: Platform` - The platform ('discord', etc.)
- `reply(response)` - Reply to the command
- `defer(ephemeral?)` - Defer the response for long operations
- `followUp(response)` - Follow up after deferring
- `showModal(modal)` - Show a modal dialog

**Option Types:**
- `string` - Text input
- `integer` - Whole numbers
- `number` - Decimal numbers  
- `boolean` - True/false
- `user` - User picker (returns user ID string)
- `channel` - Channel picker (returns channel ID string)
- `role` - Role picker (Discord only)
- `attachment` - File upload

**Option Features:**
- `required: true` - Make option required
- `choices: [{ name, value }]` - Predefined choices
- `autocomplete: true` - Dynamic choices via handler

### 3. Timer Plugin

Runs on a schedule. Located in `app/plugins/timers/`.

```typescript
// app/plugins/timers/cleanup.plugin.ts
import {
  type TimerHandlerPlugin,
  type PluginContext,
  type TimerConfig,
} from '@core';

export class CleanupPlugin implements TimerHandlerPlugin {
  readonly id = 'cleanup';
  readonly type = 'timer' as const;
  
  readonly timerConfig: TimerConfig = {
    intervalMs: 60 * 60 * 1000, // Every hour
    runImmediately: false,      // Don't run on startup
    maxConcurrent: 1,           // Only one at a time
  };

  private context?: PluginContext;

  async load(context: PluginContext): Promise<void> {
    this.context = context;
    context.logger.info('CleanupPlugin loaded');
  }

  async unload(): Promise<void> {
    this.context?.logger.info('CleanupPlugin unloaded');
  }

  async tick(context: PluginContext): Promise<void> {
    context.logger.info('Running cleanup...');
    // Do cleanup work
  }
}
```

---

## AI Tools

Tools are functions the AI can call. Auto-discovered from `app/plugins/ai/tools/*.tool.ts`.

```typescript
// app/plugins/ai/tools/weather.tool.ts
import type { 
  Tool, 
  ToolMetadata, 
  ToolSchema, 
  ToolResult, 
  ToolExecutionContext 
} from '@core';

export class WeatherTool implements Tool {
  readonly metadata: ToolMetadata = {
    name: 'weather',
    description: 'Get current weather for a location',
    version: '1.0.0',
    author: 'system',
    keywords: ['weather', 'temperature', 'forecast'],
    category: 'information',
    priority: 5,
  };

  readonly schema: ToolSchema = {
    type: 'function',
    name: 'weather',
    description: 'Get current weather conditions for a city',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: 'City name (e.g., "Copenhagen")',
        },
        units: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: 'Temperature units',
        },
      },
      required: ['city'],
      additionalProperties: false,
    },
    strict: true,
  };

  // Optional: return false to skip loading (e.g., missing API key)
  validate(): boolean {
    return !!process.env.WEATHER_API_KEY;
  }

  async execute(args: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    const { city, units = 'celsius' } = args as { city: string; units?: string };

    try {
      // Fetch weather data...
      const temp = 22;
      
      return {
        success: true,
        data: {
          city,
          temperature: temp,
          units,
          condition: 'Sunny',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'api_error',
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
      };
    }
  }
}
```

**Tool Categories:** `creative`, `information`, `utility`, `admin`, `general`

**Tool Access Control:** Tools are filtered per-user based on their roles before the LLM call, so the AI never sees tools the user can't access.

---

## Event Bus

Plugins communicate via events. Common events:

```typescript
// Emit events
context.eventBus.emit('message:send', { channelId, content, replyTo });
context.eventBus.emit('typing:start', { channelId });

// Listen to events
context.eventBus.on('message:received', (message) => { ... });
context.eventBus.on('command:received', (invocation) => { ... });
context.eventBus.on('command:autocomplete', (request) => { ... });
context.eventBus.on('interaction:button', (interaction) => { ... });
context.eventBus.on('interaction:select', (interaction) => { ... });
context.eventBus.on('interaction:modal', (interaction) => { ... });
```

---

## Database

Repositories in `core/database/`. Uses SQLite with bun:sqlite.

```typescript
import { 
  insertMessage, 
  getRecentMessages,
  searchSimilar,
} from '@core/database';

// Users
import { upsertUser, getUserByPlatformId } from '@core/database';

// Memories
import { 
  saveMemory, 
  getMemories, 
  searchMemories, 
  deleteMemory 
} from '@core/database';

// User Roles (for access control)
import {
  getOrRefreshUserRoles,
  resolveRolesToGroups,
  formatGroupsForLog,
} from '@core/database';
```

**Key Tables:**
- `messages` - Chat message history with embeddings
- `users` - User profiles across platforms
- `memories` - Per-user per-guild memory storage
- `user_roles` - Cached role → group mappings (24h TTL)

**Migrations:** `migrations/001_create_messages.ts`, etc.
- Run: `bun cli.ts db:migrate`
- Rollback: `bun cli.ts db:rollback`
- Status: `bun cli.ts db:status`

---

## User Roles & Access Control

The bot checks access at the adapter level before events reach plugins.

### How It Works

1. **Config defines rules:** `plugins` and `tools` sections define access rules
2. **Adapter checks access:** Before emitting events, adapter checks user/role/guild
3. **Access denied:** User gets ephemeral "permission denied" message
4. **Access granted:** Event emitted, plugins handle normally

### Access Context

The adapter builds an `AccessContext` with:
- `platform` - 'discord', 'slack', etc.
- `userId` - User's platform ID
- `roleIds` - User's role IDs (Discord roles, etc.)
- `guildId` - Server/guild ID

### Checking Access in Code

```typescript
import { checkAccess, getAccessibleTools, type AccessContext } from '@core';

// Build access context
const context: AccessContext = {
  platform: 'discord',
  userId: user.id,
  roleIds: user.roleIds,
  guildId: message.guildId,
};

// Check if user has access to a feature
const hasAccess = checkAccess(featureAccess, context, config);

// Get tools accessible to a user
const accessibleTools = getAccessibleTools(allTools, context, config);
```

### Terminal Output

Messages are logged with resolved group names:
```
[14:32:15] Server/#general │ User [admin]: hello
[14:32:16] Server/#general │ OtherUser [everyone]: hi
```

---

## Testing

```typescript
// tests/example.test.ts
import { test, expect, describe, beforeEach, mock } from 'bun:test';

describe('MyPlugin', () => {
  test('should do something', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run tests: `bun test`

---

## Development

```bash
# Start with hot reload
bun run dev

# Run specific command
bun cli.ts discord

# Database commands
bun cli.ts db:migrate
bun cli.ts db:status
```

## Quick Reference

| Plugin Type | Location | Key Interface |
|-------------|----------|---------------|
| Message | `app/plugins/message/*.plugin.ts` | `MessageHandlerPlugin` |
| Slash Command | `app/plugins/slash/<cmd>/plugin.ts` | `CommandHandlerPlugin` |
| Timer | `app/plugins/timers/*.plugin.ts` | `TimerHandlerPlugin` |
| AI Tool | `app/plugins/ai/tools/*.tool.ts` | `Tool` |

---

## CLI Commands

CLI commands are located in `app/commands/`. Uses Laravel-style signatures.

```typescript
// app/commands/greet.command.ts
import { Command } from '@core';

export default class GreetCommand extends Command {
  // Signature defines command name, arguments, and options
  static override signature = `
    greet
    {name? : Name to greet (optional)}
    {--u|uppercase : Shout the greeting}
    {--t|times=1 : Number of times to greet}
  `;

  static override description = 'Greet someone';

  async handle(): Promise<number> {
    // Get argument with default
    const name = this.argument('name', 'World');
    
    // Get options
    const uppercase = this.option('uppercase') as boolean;
    const times = parseInt(this.option('times') as string, 10);

    let greeting = `Hello, ${name}!`;
    if (uppercase) greeting = greeting.toUpperCase();

    for (let i = 0; i < times; i++) {
      this.success(greeting);  // Green output
    }

    return 0; // Exit code
  }
}
```

**Signature Syntax:**
- `{name}` - Required argument
- `{name?}` - Optional argument
- `{name=default}` - Argument with default
- `{name*}` - Array argument (rest)
- `{--flag}` - Boolean option
- `{--o|option}` - Option with short alias
- `{--option=default}` - Option with default value
- `{ : Description}` - Add description after colon

**Output Methods:**
- `this.success(msg)` - Green text
- `this.info(msg)` - Blue text
- `this.warn(msg)` - Yellow text
- `this.error(msg)` - Red text
- `this.line(msg)` - Plain text

**Grouping:** Use colons in command name for groups: `db:migrate`, `discord:channels`

---

## Migrations

Database migrations in `migrations/`. Numbered sequentially.

```typescript
// migrations/003_add_settings.ts
import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL
    );
  `);
}

export function down(db: Database): void {
  db.exec('DROP TABLE IF EXISTS settings');
}
```

**Commands:**
```bash
bun cli.ts db:migrate    # Run pending migrations
bun cli.ts db:rollback   # Rollback last migration
bun cli.ts db:reset      # Rollback all (destructive!)
bun cli.ts db:status     # Show migration status
```

---

## Core Modules

The `core/` directory contains platform-agnostic framework code:

| Module | Description |
|--------|-------------|
| `event-bus.ts` | Pub/sub event system for plugin communication |
| `plugin-loader.ts` | Auto-discovers and loads plugins from `app/plugins/` |
| `tool-loader.ts` | Auto-discovers AI tools from `*.tool.ts` files |
| `command-registry.ts` | Registers slash commands for platform adapters |
| `llm-client.ts` | OpenRouter API client for LLM calls |
| `embedder.ts` | Text embedding using transformers.js |
| `config.ts` | Bot configuration loading and access control utilities |
| `cli/` | CLI framework (Command base class, parser, runner) |
| `database/` | Database client and repositories |
| `types/` | TypeScript interfaces and type guards |

**Key Exports from `@core`:**
```typescript
import {
  // Types
  type Plugin,
  type MessageHandlerPlugin,
  type CommandHandlerPlugin,
  type TimerHandlerPlugin,
  type Tool,
  type BotMessage,
  type BotUser,
  type BotConfig,
  type EventBus,
  type Logger,
  type CommandInvocation,
  type FeatureAccess,
  
  // Functions
  registerCommand,
  unregisterCommand,
  loadPlugins,
  loadTools,
  createEventBus,
  checkAccess,
  getAccessibleTools,
  
  // Classes
  Command,
} from '@core';
```

---

## Platform Adapters

Adapters translate platform-specific events to/from the normalized format.

### Discord Adapter (`bot/discord/adapter.ts`)

```typescript
import { DiscordAdapter } from '@bot/discord/adapter';

const adapter = new DiscordAdapter({
  token: process.env.DISCORD_TOKEN,
  eventBus,
  logger,
});

await adapter.connect();
```

**Responsibilities:**
- Converts Discord.js events → `BotMessage`, `CommandInvocation`, etc.
- Handles `message:send` events → Discord API calls
- Registers slash commands with Discord API
- Transforms buttons, selects, modals to Discord components
- Populates `user.roleIds` from guild member data

**Adding a New Platform:**

1. Create `bot/<platform>/adapter.ts`
2. Implement event translation (incoming → normalized, outgoing → platform API)
3. Handle slash command registration for the platform
4. Create startup command in `app/commands/<platform>.command.ts`

---

## Common Mistakes to Avoid

### ❌ Using Discord.js API in Plugins

```typescript
// WRONG - Discord.js style
const subcommand = invocation.options?.getSubcommand();
const value = invocation.options?.getString('name');

// CORRECT - Normalized API
const subcommand = invocation.subcommand;
const value = invocation.args.name as string;
```

### ❌ Complex Plugin IDs

```typescript
// WRONG
readonly id = 'greet-command';
readonly id = 'memory-slash-plugin';

// CORRECT
readonly id = 'greet';
readonly id = 'memory';
```

### ❌ Forgetting to Filter by Command Name

```typescript
// WRONG - handles ALL commands
private async handleCommand(invocation: CommandInvocation): Promise<void> {
  // This runs for every command!
}

// CORRECT - filter first
private async handleCommand(invocation: CommandInvocation): Promise<void> {
  if (invocation.commandName !== 'mycommand') return;
  // Now safe to handle
}
```

---

## Testing

Tests in `tests/*.test.ts`. Uses Bun's built-in test runner.

```typescript
// tests/my-feature.test.ts
import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { MyPlugin } from '../app/plugins/message/my.plugin';

// Mock dependencies
const mockLogger = {
  info: mock(() => {}),
  debug: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

const mockEventBus = {
  on: mock(() => {}),
  emit: mock(() => {}),
  off: mock(() => {}),
};

describe('MyPlugin', () => {
  let plugin: MyPlugin;

  beforeEach(() => {
    plugin = new MyPlugin();
  });

  afterEach(() => {
    mock.restore();
  });

  test('should load without error', async () => {
    await plugin.load({ eventBus: mockEventBus, logger: mockLogger } as any);
    expect(mockLogger.info).toHaveBeenCalled();
  });
});
```

**Run Tests:**
```bash
bun test                    # Run all tests
bun test my-feature         # Run matching tests
bun test --watch            # Watch mode
bun test --coverage         # With coverage
```
