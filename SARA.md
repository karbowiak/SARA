# SARA - Status Summary

This document is a quick status snapshot of what from the original SARA has been ported into the current bot framework.
For development details, see [AGENTS.md](./AGENTS.md).

## Implemented
- ✅ AI chat with tool calling
- ✅ Memory system (save/recall/forget/list)
- ✅ Web search tool (Tavily API)
- ✅ Message history search (semantic + recent)
- ✅ Slash commands (/memory, /imagine, /reminder, /knowledge, /media)
- ✅ Image generation (OpenRouter, style presets, reference images)
- ✅ Thinking tool (reasoning model escalation)
- ✅ Last seen tool (user activity tracking)
- ✅ Currency conversion tool (real-time exchange rates)
- ✅ Media processing: Instagram/TikTok/Reddit (/media command + handlers)

## Partially Implemented
- ⚠️ Stream monitoring (Twitch/Kick/Chaturbate/MFC):
  - Status checks and subscriptions exist
  - Notifications are not wired to message sends
