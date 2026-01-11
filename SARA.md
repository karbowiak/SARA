# SARA - Smart Automated Response Assistant

SARA is a Discord bot built with Bun, TypeScript, and a plugin-based architecture. This document describes its features and serves as a reference for building a platform-agnostic version.

## Current Architecture (Discord-specific)

```
src/
├── core/              # Core framework
│   ├── Bot.ts         # Discord.js client wrapper
│   ├── EventBus.ts    # Pub/sub event system
│   ├── PluginManager.ts
│   ├── Logger.ts      # Structured logging
│   └── ToolRegistry.ts # AI tool management
├── plugins/           # Feature plugins
│   ├── onInteraction/ # Slash command handlers
│   ├── onMessage/     # Message event handlers
│   ├── onTimer/       # Scheduled tasks
│   └── tools/         # AI-callable tools
├── services/          # Business logic services
├── db/                # Database layer (SQLite + Drizzle)
├── types/             # TypeScript definitions
└── utils/             # Shared utilities
```

## Features

### 1. AI Chat Integration
- **Trigger methods**: DMs, @mentions, replies to bot messages
- **Model**: OpenAI GPT-4 / OpenRouter compatible
- **Capabilities**:
  - Text conversations with context
  - Image analysis (GPT-4 Vision)
  - Content moderation (OpenAI Moderation API)
  - Smart message splitting (Discord 2000 char limit)
  - Tool calling for extended functionality

### 2. AI Tools (Function Calling)
| Tool | Description |
|------|-------------|
| `ImageGenerationTool` | Generate images via DALL-E 3 |
| `WebSearchTool` | Search the web via Tavily API |
| `MemoryTools` | Save/recall user preferences |
| `StreamAlertTool` | Check stream status |
| `ThinkingTool` | Extended reasoning |
| `SearchMessagesTool` | Search chat history |
| `PingTool` | Network diagnostics |
| `ROAStatusTool` | EVE Online ROA status |

### 3. Slash Commands
| Command | Description |
|---------|-------------|
| `/ping` | Basic connectivity test |
| `/about` | Bot information embed |
| `/image` | AI image generation with options |
| `/stream add/remove/list` | Manage stream alerts |

### 4. Media Link Processing
Automatically detects and processes social media links:

- **Instagram** (`InstagramMessagePlugin`)
  - Detects Instagram post/reel URLs
  - Downloads media (photos, videos)
  - Handles carousels (multiple images)
  - Compresses videos if needed
  - Suppresses Discord embeds
  - Shows metadata (likes, comments, author)

- **TikTok** (`TikTokMessagePlugin`)
  - Detects TikTok URLs (including vm.tiktok.to)
  - Downloads videos
  - Automatic compression for large files
  - Shows video metadata

- **Reddit** (`EmbedRedditImagesPlugin`)
  - Embeds Reddit images/galleries

### 5. Stream Monitoring
- Multi-platform: Twitch, YouTube, Kick
- No API keys required (public APIs)
- Periodic status checks (2 min interval)
- Rich notifications with thumbnails
- Per-channel subscriptions

### 6. Memory System
- Per-user preference storage
- Searchable knowledge base
- Message history indexing

### 7. Timer-Based Features
- `StatsTimerPlugin` - Periodic server statistics
- Stream status polling

## Plugin System

### Plugin Types
```typescript
interface Plugin {
  readonly id: string;
  readonly type: 'onInteraction' | 'onMessage' | 'onTimer' | 'tool';
  load(context: PluginContext): void | Promise<void>;
  unload(): void | Promise<void>;
}
```

### Plugin Context
```typescript
interface PluginContext {
  readonly client: Client;      // Discord client
  readonly eventBus: EventBus;  // Event pub/sub
  readonly logger: Logger;      // Structured logging
  readonly config?: PluginConfig;
}
```

### Event Flow
1. Discord.js emits native event
2. `Bot.ts` bridges to `EventBus`
3. EventBus dispatches to subscribed plugins
4. Plugins handle events independently
5. Errors are isolated (won't crash bot)

## Key Design Patterns

### 1. Event-Driven Architecture
- Central EventBus decouples Discord.js from plugins
- Plugins subscribe to events they care about
- Error isolation prevents cascading failures

### 2. Plugin Isolation
- Each plugin has its own lifecycle
- Plugins can be loaded/unloaded at runtime
- Metadata tracking (invocations, errors)

### 3. Adapter Pattern (for platform abstraction)
Discord-specific code lives in:
- `Bot.ts` - Client wrapper
- Event bridging in `setupEventBridges()`
- Discord.js types in plugin handlers

---

## Agnostic Redesign Proposal

To make SARA platform-agnostic (Discord, Slack, Telegram), we need to:

### 1. Abstract Message Types

```typescript
// Platform-agnostic message
interface BotMessage {
  id: string;
  content: string;
  author: {
    id: string;
    name: string;
    isBot: boolean;
  };
  channel: {
    id: string;
    type: 'dm' | 'group' | 'guild';
  };
  attachments: Attachment[];
  replyTo?: string;
  mentions: string[];
  timestamp: Date;
  platform: 'discord' | 'slack' | 'telegram';
  raw: unknown; // Original platform message
}
```

### 2. Abstract Commands

```typescript
// Platform-agnostic command
interface BotCommand {
  name: string;
  description: string;
  options: CommandOption[];
  execute(ctx: CommandContext): Promise<CommandResult>;
}

interface CommandContext {
  args: Record<string, unknown>;
  author: User;
  channel: Channel;
  reply(content: ReplyContent): Promise<void>;
}
```

### 3. Platform Adapters

```typescript
interface PlatformAdapter {
  readonly platform: string;
  
  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  
  // Events → normalized messages
  onMessage(handler: (msg: BotMessage) => void): void;
  onCommand(handler: (cmd: CommandInvocation) => void): void;
  
  // Actions
  sendMessage(channelId: string, content: MessageContent): Promise<void>;
  react(messageId: string, emoji: string): Promise<void>;
  
  // Platform features (optional)
  registerCommands?(commands: BotCommand[]): Promise<void>;
  suppressEmbed?(messageId: string): Promise<void>;
}
```

### 4. Proposed Directory Structure

```
app/
├── core/
│   ├── bot.ts              # Main bot orchestrator
│   ├── event-bus.ts        # Platform-agnostic events
│   ├── plugin-manager.ts   # Plugin lifecycle
│   ├── tool-registry.ts    # AI tool management
│   └── logger.ts           # Structured logging
│
├── adapters/
│   ├── adapter.ts          # Base adapter interface
│   ├── discord/
│   │   ├── adapter.ts      # Discord implementation
│   │   └── types.ts        # Discord-specific types
│   ├── slack/
│   │   ├── adapter.ts      # Slack implementation
│   │   └── types.ts        # Slack-specific types
│   └── telegram/           # Future
│
├── plugins/
│   ├── plugin.ts           # Base plugin interface
│   ├── ai/
│   │   └── chat.plugin.ts  # AI chat handler
│   ├── media/
│   │   ├── instagram.plugin.ts
│   │   └── tiktok.plugin.ts
│   ├── commands/
│   │   ├── ping.command.ts
│   │   └── about.command.ts
│   └── tools/
│       ├── image-gen.tool.ts
│       └── web-search.tool.ts
│
├── services/
│   ├── ai.service.ts       # OpenAI integration
│   ├── instagram.service.ts
│   ├── tiktok.service.ts
│   └── stream.service.ts
│
├── types/
│   ├── message.ts          # BotMessage, etc.
│   ├── command.ts          # BotCommand, etc.
│   ├── plugin.ts           # Plugin interfaces
│   └── adapter.ts          # Adapter interfaces
│
└── cli/                    # Already implemented
    └── ...
```

### 5. Feature Compatibility Matrix

| Feature | Discord | Slack | Notes |
|---------|---------|-------|-------|
| Slash commands | ✅ Native | ✅ Native | Both support natively |
| Message reactions | ✅ | ✅ | Different emoji formats |
| Rich embeds | ✅ | ✅ Blocks | Need abstraction |
| File uploads | ✅ 25MB+ | ✅ Varies | Size limits differ |
| Threads | ✅ | ✅ | Both support |
| DMs | ✅ | ✅ | Both support |
| Edit messages | ✅ | ✅ | Both support |
| Delete messages | ✅ | ✅ | Both support |
| Embed suppression | ✅ | ❌ | Discord-only |
| Link unfurling | Auto | ✅ | Slack has better control |

### 6. Migration Priority

1. **Phase 1**: Core abstraction
   - Message types
   - Event bus (platform-agnostic)
   - Adapter interface

2. **Phase 2**: Discord adapter
   - Port existing Bot.ts logic
   - Normalize Discord.js events

3. **Phase 3**: Plugin migration
   - AI chat plugin (most complex)
   - Media plugins (Instagram, TikTok)
   - Command plugins

4. **Phase 4**: Slack adapter
   - Implement adapter interface
   - Test with existing plugins

5. **Phase 5**: Shared features
   - Unified command registration
   - Cross-platform config
