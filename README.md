# Bot Framework

A platform-agnostic bot framework built with Bun and TypeScript. Features a plugin architecture, AI tool system, and support for multiple bot personalities.

## Features

- **Plugin System** - Message handlers, slash commands, timers, AI tools
- **AI Integration** - OpenRouter LLM with function calling
- **Memory System** - Per-user preference storage with semantic search
- **Multiple Personalities** - Run different bot configs from the same codebase
- **Platform Agnostic** - Core is decoupled from Discord (adapter pattern)

## Quick Start

```bash
# Install dependencies
bun install

# Copy config template
cp config/config.example.ts config/config.ts
# Edit config/config.ts with your tokens

# Run database migrations
bun cli.ts db:migrate

# Start the bot
bun cli.ts discord
```

## Configuration

Configuration lives in `config/config.ts`. See `config/config.example.ts` for all options.

```bash
# Run with a specific config (for multiple bot personalities)
bun cli.ts discord --config config/config-sara.ts
```

**Required tokens:**
- `discord` - Discord bot token from [Discord Developer Portal](https://discord.com/developers/applications)
- `openrouter` - API key from [OpenRouter](https://openrouter.ai/)
- `tavily` - (Optional) API key from [Tavily](https://tavily.com/) for web search

## Development

```bash
# Start with hot reload
bun run dev

# Run tests
bun test

# Lint & format
bun run lint
bun run lint:fix
```

## Documentation

- [AGENTS.md](./AGENTS.md) - Development guide (plugins, tools, commands, testing)
- [TOOLS.md](./TOOLS.md) - AI tools reference and implementation status
- [SARA.md](./SARA.md) - Original design document and architecture notes

## Project Structure

```
app/
├── commands/        # CLI commands
└── plugins/
    ├── ai/          # AI handler + tools
    ├── message/     # Message handlers
    ├── slash/       # Slash commands
    └── timers/      # Scheduled tasks
bot/discord/         # Discord adapter
config/              # Bot configurations
core/                # Platform-agnostic framework
migrations/          # Database migrations
tests/               # Test files
```

## License

MIT
