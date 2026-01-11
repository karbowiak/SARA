# SARA - Original Design Document

> **Note:** This document describes the original SARA bot that inspired this framework. The current implementation has evolved into a platform-agnostic architecture. See [AGENTS.md](./AGENTS.md) for the current development guide.

## Original SARA Features

SARA (Smart Automated Response Assistant) was a Discord-specific bot with these features:

### AI Chat Integration
- Trigger methods: DMs, @mentions, replies to bot messages
- Model: OpenAI GPT-4 / OpenRouter compatible
- Capabilities: Text conversations, image analysis (GPT-4 Vision), content moderation, tool calling

### AI Tools (Original)
| Tool | Description |
|------|-------------|
| `ImageGenerationTool` | Generate images via DALL-E 3 |
| `WebSearchTool` | Search the web via Tavily API |
| `MemoryTools` | Save/recall user preferences |
| `StreamAlertTool` | Check stream status |
| `ThinkingTool` | Extended reasoning |
| `SearchMessagesTool` | Search chat history |

### Media Link Processing
- **Instagram** - Download posts/reels, handle carousels, compress videos
- **TikTok** - Download videos, automatic compression
- **Reddit** - Embed images/galleries

### Stream Monitoring
- Multi-platform: Twitch, YouTube, Kick
- Periodic status checks with rich notifications

---

## Platform-Agnostic Redesign

The current framework implements the redesign proposal from the original SARA:

### Abstract Message Types

```typescript
// Platform-agnostic message (implemented in core/types/message.ts)
interface BotMessage {
  id: string;
  content: string;
  author: BotUser;
  channel: BotChannel;
  attachments: BotAttachment[];
  replyTo?: string;
  mentionsBot: boolean;
  timestamp: Date;
  platform: 'discord' | 'slack' | 'telegram';
  raw: unknown;
}
```

### Platform Adapters

```typescript
// Implemented in bot/<platform>/adapter.ts
interface PlatformAdapter {
  readonly platform: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  // Events → normalized messages via EventBus
}
```

### Current Directory Structure

```
app/
├── commands/           # CLI commands (db, discord, prompt)
└── plugins/
    ├── ai/             # AI chat handler + tools
    │   ├── ai.plugin.ts
    │   └── tools/      # Auto-discovered *.tool.ts
    ├── message/        # Message handlers
    ├── slash/          # Slash commands (/ping, /demo, /memory)
    └── timers/         # Scheduled tasks

bot/
└── discord/
    └── adapter.ts      # Discord.js adapter

core/                   # Platform-agnostic framework
├── event-bus.ts
├── plugin-loader.ts
├── tool-loader.ts
├── llm-client.ts
├── config.ts
├── database/
└── types/

config/                 # Bot configurations (gitignored)
├── config.example.ts
└── config.ts
```

### Feature Compatibility (Future Platforms)

| Feature | Discord | Slack | Notes |
|---------|---------|-------|-------|
| Slash commands | ✅ Native | ✅ Native | Both support |
| Rich embeds | ✅ | ✅ Blocks | Need abstraction |
| File uploads | ✅ 25MB+ | ✅ Varies | Size limits differ |
| DMs | ✅ | ✅ | Both support |
| Threads | ✅ | ✅ | Both support |

---

## Migration from Original SARA

Features ported to new framework:
- ✅ AI chat with tool calling
- ✅ Memory system (save/recall/forget/list)
- ✅ Web search tool (Tavily API)
- ✅ Message history search (semantic + recent)
- ✅ Slash commands (/ping, /demo, /memory, /imagine)
- ✅ Image generation (OpenRouter, multiple models, style presets)
- ✅ Thinking tool (reasoning model escalation)
- ✅ Last seen tool (user activity tracking)
- ✅ Currency conversion tool (real-time exchange rates)

Features not yet ported:
- ⬜ Instagram/TikTok media processing
- ⬜ Stream monitoring (Twitch/YouTube/Kick)
