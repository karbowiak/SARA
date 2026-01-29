# Lurker Mode - Active Conversation Participation

> **Status:** Design Phase - Not Implemented  
> **Last Updated:** 2026-01-12

## Concept

Instead of only responding when @mentioned, the bot actively monitors conversations and decides when it has something valuable to contribute - like a real participant in a group chat.

## Architecture

```
Message arrives → Logger plugin stores it
                ↓
          Gatekeeper Plugin
          (cheap/free model)
          "Should I respond?"
                ↓
         YES (score > threshold)
                ↓
          Full AI Response
          (expensive model)
```

## Two-Tier Model Approach

### Tier 1: Gatekeeper (Free/Cheap)
**Purpose:** Quickly decide if the bot should speak up  
**Models:**
- `google/gemma-2-9b-it:free`
- `meta-llama/llama-3.1-8b-instruct:free`
- `mistralai/mistral-7b-instruct:free`

**Input:**
- Last 10 messages (minimal context)
- Current message
- Bot's personality traits
- Recent conversation summary

**Output:**
```json
{
  "shouldRespond": true,
  "reason": "User asked a question about server rules that I can answer",
  "confidence": 0.85,
  "urgency": "normal"
}
```

### Tier 2: Full AI (Expensive)
**Purpose:** Generate actual response  
**Models:** Normal config (GPT-4, Claude, etc.)  
**Input:** Full context (memories, knowledge, semantic search)

## Gatekeeper Decision Criteria

The gatekeeper should consider:

### ✅ Good reasons to respond:
- **Direct relevance:** Topic matches bot's knowledge/expertise
- **Unanswered question:** No one has answered after 30s+
- **Misinformation:** Someone said something factually incorrect (careful!)
- **Request for opinion:** "what do you think?" type questions
- **Bot mentioned indirectly:** "I wonder if Sara knows..."
- **Natural opening:** Conversation lull with relevant topic

### ❌ Bad reasons to respond:
- **Just chatting:** Casual back-and-forth between users
- **Short messages:** "lol", "ok", "brb" - no substance
- **Recent bot message:** Already spoke recently
- **Private moment:** Seems like a 1-on-1 conversation
- **Off-topic:** Not relevant to anything bot knows
- **Heated argument:** Let humans resolve it

## Gatekeeper Prompt Template

```markdown
You are a conversation monitor for a Discord bot named {BOT_NAME}.
Your job is to decide if the bot should speak up in the current conversation.

## Bot's Role
{BOT_IDENTITY}

## Recent Conversation
{LAST_10_MESSAGES}

## Current Message
@{USER}: {MESSAGE}

## Guidelines
- The bot should add value, not just noise
- Avoid interrupting human-to-human conversations
- Speak up if the bot can answer a question
- Stay silent during casual chitchat unless directly relevant
- Consider if anyone else might answer first

## Your Task
Analyze if the bot should respond. Output JSON:
{
  "shouldRespond": boolean,
  "reason": "brief explanation",
  "confidence": 0.0-1.0,
  "urgency": "low" | "normal" | "high"
}
```

## Rate Limiting & Cooldowns

### Pre-Gatekeeper Filters (Cheap)
Only run gatekeeper if:
- Message length > 50 characters
- Contains question mark OR keyword
- Not from another bot
- Channel not in cooldown

### Post-Gatekeeper Cooldowns
After bot responds:
- **Same channel:** 5 minute cooldown (unless @mentioned)
- **Same user:** 2 minute cooldown
- **Message count:** Wait for 3+ messages before responding again

### Keyword Triggers
Run gatekeeper immediately if message contains:
- Bot's name (even without @)
- Configured expertise keywords (e.g., "server rules", "EVE Online")
- Common question patterns ("how do i", "what is", "can someone")

## Configuration

```typescript
lurker: {
  enabled: true,
  
  // Gatekeeper model (free/cheap)
  gatekeeperModel: 'google/gemma-2-9b-it:free',
  
  // Minimum confidence to respond (0.0-1.0)
  confidenceThreshold: 0.75,
  
  // Cooldowns (milliseconds)
  channelCooldown: 300000,  // 5 minutes
  userCooldown: 120000,     // 2 minutes
  minMessagesBetween: 3,
  
  // Pre-filters
  minMessageLength: 50,
  requireQuestionOrKeyword: true,
  
  // Keywords that trigger gatekeeper
  keywords: ['rules', 'how', 'what', 'why', 'help'],
  
  // Channels to exclude from lurking
  excludeChannels: ['bot-spam', 'admin-only'],
  
  // Access control
  groups: ['admin'], // Only enable for certain servers
}
```

## Implementation Plan

### 1. Create Lurker Plugin
**File:** `app/plugins/message/lurker.plugin.ts`

```typescript
export class LurkerPlugin implements MessageHandlerPlugin {
  readonly id = 'lurker';
  readonly type = 'message' as const;
  readonly scope = 'all' as const; // See ALL messages
  readonly priority = -1; // Run after logger but before AI

  private cooldowns: Map<string, number>; // channelId -> timestamp
  private gatekeeperClient: LLMClient;

  shouldHandle(message: BotMessage): boolean {
    // Pre-filters: check message length, keywords, cooldowns
  }

  async handle(message: BotMessage, context: PluginContext): Promise<void> {
    // Call gatekeeper model
    const decision = await this.callGatekeeper(message);
    
    if (decision.shouldRespond && decision.confidence >= threshold) {
      // Trigger AI plugin by emitting event or calling it directly
      // Set cooldown
    }
  }
}
```

### 2. Gatekeeper Response Parser
Extract JSON from gatekeeper response, validate schema

### 3. Cooldown Manager
Track per-channel, per-user cooldowns

### 4. Integration with AI Plugin
- Option A: Emit custom event that AI plugin listens to
- Option B: Share message handling logic, call directly
- Option C: Set flag on message indicating "gatekeeper approved"

### 5. Analytics/Logging
Track:
- Total messages evaluated
- Gatekeeper decisions (yes/no)
- Confidence scores
- Actual responses sent
- False positives (bot was annoying)

## Risks & Mitigations

### Risk: Bot becomes annoying
**Mitigation:** 
- Conservative confidence threshold (0.75+)
- Strict cooldowns
- Per-channel disable via `/lurker off`
- User feedback: "was this helpful?" reactions

### Risk: Cost (even cheap models add up)
**Mitigation:**
- Aggressive pre-filters
- Rate limit per guild (X evaluations/hour)
- Disable in high-traffic channels

### Risk: Misreading social cues
**Mitigation:**
- Training data includes examples of when NOT to speak
- "Urgency" signal - only respond to "high" urgency without delay
- Bias toward silence when uncertain

### Risk: Responding to sensitive topics
**Mitigation:**
- Keyword blocklist (politics, religion, etc.)
- Channel-specific rules
- Admin override to shut up immediately

## Testing Strategy

### Phase 1: Shadow Mode
- Run gatekeeper on all messages
- Log decisions but DON'T respond
- Analyze: false positives, false negatives

### Phase 2: Single Channel
- Enable in one test channel
- Conservative settings
- Monitor closely

### Phase 3: Opt-in Servers
- Let admins enable with `/lurker enable`
- Collect feedback

### Phase 4: Default Enabled
- Only after proven non-annoying

## Alternative: Hybrid Mode

Instead of full lurker, compromise approaches:

### "Question Detector"
Only lurk for messages with `?` that haven't been answered in 30s

### "Knowledge Search"
Silently search knowledge base on every message, only speak if high-confidence match

### "Mentioned Indirectly"
Respond to "I wonder if bot knows..." or "ask bot about..."

### "Summary Bot"
Every N messages, offer to summarize conversation (less intrusive)

## Future Enhancements

- **Learning:** Track which responses get positive reactions, adjust threshold
- **Personality modes:** "eager" vs "reserved" settings
- **Channel personalities:** More active in help channels, quieter in social
- **Group detection:** Identify 1-on-1 conversations vs group discussions
- **Sentiment analysis:** Detect heated arguments, stay out

## Open Questions

1. Should gatekeeper see message history or just current message?
2. How to handle bot speaking twice in a row (follow-up)?
3. Should users be able to "dismiss" the bot? ("shh" command?)
4. Integration with existing @mention system - do they share context?
5. Should lurker responses be marked differently? (different icon/color?)

## Related Documents

- [AGENTS.md](./AGENTS.md) - Plugin system architecture
- [SARA.md](./SARA.md) - Original bot design
- [TOOLS.md](./TOOLS.md) - Available AI tools

---

**Shelved Reason:** Interesting concept but needs careful design to avoid being annoying. Focus on core features first.
