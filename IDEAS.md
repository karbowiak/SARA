# Voice Feature Ideas for Discord Bot

Discord.js provides robust voice support via the `@discordjs/voice` package. This document outlines potential voice features we could implement.

## Required Dependencies

- `@discordjs/voice` - Main voice library
- `@discordjs/opus` or `opusscript` - Audio encoding
- FFmpeg or `ffmpeg-static` - Format conversion (for MP3, etc.)
- Encryption library (usually built-in `aes-256-gcm` support)

```bash
bun add @discordjs/voice @discordjs/opus ffmpeg-static
```

---

## Ideas

### 1. Text-to-Speech (TTS) Bot
**Complexity:** Simple (1-2 hours)

Users type a command and the bot reads text aloud in a voice channel.

**Commands:**
- `/speak <message>` - Read text in voice channel
- `/speak join` - Join user's current voice channel
- `/speak leave` - Leave voice channel
- `/speak voice <voice>` - Change TTS voice

**Implementation:**
- Integrate with TTS services (ElevenLabs, Google Cloud, OpenAI, or browser TTS)
- Create audio resource from TTS output
- Play via `@discordjs/voice` audio player
- Support multiple voices/accents via config

**Extensions:**
- AI-generated TTS responses (bot responds to commands with voice)
- Voice personality system (different voices per channel)
- Volume control
- Rate/Speed adjustment

---

### 2. Music/YouTube Player
**Complexity:** Medium (4-8 hours)

Full-featured music bot with queue management.

**Commands:**
- `/play <url or search>` - Play audio in voice channel
- `/queue` - Show current queue
- `/skip` - Skip current track
- `/pause` / `/resume` - Control playback
- `/volume <0-100>` - Adjust volume
- `/loop` - Toggle loop mode
- `/shuffle` - Shuffle queue
- `/clear` - Clear queue

**Implementation:**
- Use `ytdl-core` or similar for YouTube audio
- Queue system with database persistence
- FFmpeg for format conversion and streaming
- Inline volume control for real-time adjustments
- Progress tracking and seeking

**Extensions:**
- Spotify integration (requires API)
- SoundCloud, Vimeo, etc.
- Auto-play similar tracks
- Playlist support
- Radio mode (infinite stream)

---

### 3. Voice Activity Monitoring
**Complexity:** Simple (1-2 hours)

Track and log voice channel activity.

**Features:**
- Detect when users join/leave voice channels
- Log voice sessions to database
- Generate analytics reports
- Real-time notifications in text channels

**Commands:**
- `/voice stats <user>` - Show voice activity stats
- `/voice leaderboard` - Most active users
- `/voice history <days>` - Recent activity
- `/voice alerts enable/disable` - Toggle join/leave notifications

**Implementation:**
- Listen to `VoiceState` events from Discord.js
- Create `voice_sessions` database table:
  - user_id, guild_id, channel_id
  - join_time, leave_time
  - duration (calculated)
- Timer plugin to track active sessions
- Message handler for notifications

**Extensions:**
- Activity heatmaps (when people are most active)
- Auto-move users based on activity
- "AFK" detection and auto-move
- Export reports (CSV, JSON)

---

### 4. AI-Powered Voice Assistant
**Complexity:** Medium to Complex (8-12+ hours)

Voice chat interface with the LLM - users speak, bot processes and responds.

**Commands:**
- `/voice-chat <message>` - Speak a message (uses TTS)
- `/voice-ai join` - Join voice and enable voice mode
- `/voice-ai enable/disable` - Toggle voice mode in current channel

**Implementation:**
- Speech-to-text: Transcribe audio from voice channel
  - Option A: Use Discord's native STT (if available)
  - Option B: Record audio stream, send to Whisper/OpenAI STT API
- Process transcription via existing AI pipeline
- Generate response via LLM
- TTS output the response back to voice channel
- Conversation context maintained per channel

**Extensions:**
- Multi-user conversations (bot can hear multiple people)
- Voice identity recognition (know who's speaking)
- Different personalities/voices per server
- Interrupt handling (user speaks while bot is talking)
- Language detection and translation

**Challenges:**
- Discord doesn't expose raw audio from users (no built-in STT)
- Would require external recording solution or API limitations
- May need users to record clips via separate tool

---

### 5. Soundboard Effects
**Complexity:** Simple (1-2 hours)

Play pre-defined sound effects in voice channels.

**Commands:**
- `/sound <effect>` - Play a sound effect
- `/sound list` - List available sounds
- `/sound upload <file>` - Upload custom sound
- `/sound delete <effect>` - Remove a sound
- `/sound volume <0-100>` - Adjust sound volume

**Implementation:**
- Store sound files in `sounds/` directory or database
- Audio resource creation for each sound
- Queue system to prevent overlapping sounds
- Volume control via inline volume
- Access control (admin-only sounds)

**Extensions:**
- Sound packs/themes (different sets of sounds)
- Random sound of the day
- Sound categories (funny, memes, alerts)
- Keyboard shortcuts (via Discord interactions)
- Sound scheduling (play at specific times)

---

### 6. Radio/Stream Broadcasting
**Complexity:** Medium (4-6 hours)

Stream audio to multiple voice channels simultaneously.

**Commands:**
- `/radio start <url>` - Start streaming radio
- `/radio stop` - Stop streaming
- `/radio join` - Make bot join voice channel
- `/radio leave` - Leave voice channel
- `/radio status` - Show current stream status

**Implementation:**
- Stream audio from internet radio URLs
- Use FFmpeg to convert stream format
- Single audio player subscribed to multiple voice connections
- Connection management (handle disconnects, reconnects)
- Bitrate optimization

**Extensions:**
- Schedule radio shows (timer plugin)
- Podcast playback at specific times
- Multi-radio support (different channels, different stations)
- Stream to specific guilds only (access control)
- Stream recording for later playback

---

### 7. Voice Games/Trivia
**Complexity:** Medium (6-10 hours)

Interactive games that use voice for questions/answers.

**Commands:**
- `/trivia start` - Start trivia game
- `/trivia join` - Join current game
- `/trivia answer <choice>` - Submit answer
- `/trivia leaderboard` - Show scores

**Implementation:**
- Question bank with TTS narration
- Voice channel management (move players to game channel)
- Score tracking per user
- Multiple game modes:
  - Standard trivia (multiple choice)
  - Audio-based (identify song/sound)
  - Voice answers (users speak answer)
- Timer for questions

**Extensions:**
- Custom question creation
- Question categories (music, movies, science, etc.)
- Difficulty levels
- Team play (multiple users vs bot)
- Leaderboards across servers

---

## Implementation Notes

### Framework Integration

Your existing plugin architecture handles voice features well:

- **Slash commands** for user interactions (`/join`, `/play`, etc.)
- **Message handlers** for voice state notifications
- **Timer plugin** for auto-disconnect, scheduled events
- **Event bus** for voice state changes (join/leave)
- **Database** for persistent data (sessions, queues, stats)

### Voice Connection Management

```typescript
import { joinVoiceChannel, createAudioPlayer, createAudioResource } from '@discordjs/voice';

// Join a voice channel
const connection = joinVoiceChannel({
  channelId: channel.id,
  guildId: channel.guild.id,
  adapterCreator: channel.guild.voiceAdapterCreator,
});

// Create audio player
const player = createAudioPlayer();

// Play audio
const resource = createAudioResource('sound.mp3');
player.play(resource);

// Subscribe connection to player
connection.subscribe(player);
```

### Database Schema Ideas

```sql
-- Voice sessions
CREATE TABLE voice_sessions (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  join_time INTEGER NOT NULL,
  leave_time INTEGER,
  duration INTEGER
);

-- Music queue
CREATE TABLE music_queue (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  position INTEGER NOT NULL,
  added_at INTEGER NOT NULL
);

-- Soundboard sounds
CREATE TABLE soundboard_sounds (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  category TEXT,
  added_by TEXT,
  created_at INTEGER NOT NULL
);
```

---

## Priority Recommendations

**Start with these (quick wins):**
1. Voice Activity Monitoring - Adds value without complex audio
2. Soundboard Effects - Fun feature, easy to implement
3. TTS Bot - Simple, showcases voice capabilities

**Then move to:**
4. Music Player - High value, more complex
5. Radio Broadcasting - Unique feature
6. Voice Games - Engaging content

**Advanced project:**
7. AI Voice Assistant - Most complex, most impressive

---

## Resources

- [Discord.js Voice Guide](https://discordjs.guide/voice/)
- [@discordjs/voice](https://discord.js.org/docs/packages/voice/main)
- [FFmpeg](https://ffmpeg.org/)
- [ElevenLabs API](https://elevenlabs.io/) - High-quality TTS
- [OpenAI Whisper](https://openai.com/research/whisper) - Speech-to-text
