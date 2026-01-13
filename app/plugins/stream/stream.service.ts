/**
 * Stream Service - Manages stream monitoring and alerts
 */

import { getSubscriptions, type StoredStream, updateStreamStatus } from '../../../core/database/streams';
import type { EventBus } from '../../../core/event-bus';

export interface StreamStatus {
  isLive: boolean;
  game?: string;
  title?: string;
  viewers?: number;
  thumbnail?: string;
}

export class StreamService {
  private pollingInterval: Timer | null = null;
  private readonly POLL_RATE = 2 * 60 * 1000; // 2 minutes

  constructor(private eventBus: EventBus) {}

  start() {
    if (this.pollingInterval) return;
    this.checkStreams();
    this.pollingInterval = setInterval(() => this.checkStreams(), this.POLL_RATE);
  }

  stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Main polling loop
   */
  async checkStreams() {
    const streams = getSubscriptions();

    // Group by platform to optimize API calls (batching) if supported
    // For now, iterate individually
    for (const stream of streams) {
      await this.checkStream(stream);
    }
  }

  private async checkStream(stream: StoredStream) {
    try {
      let status: StreamStatus | null = null;

      switch (stream.platform) {
        case 'twitch':
          status = await this.checkTwitch(stream.channel_name);
          break;
        case 'kick':
          status = await this.checkKick(stream.channel_name);
          break;
        case 'chaturbate':
          status = await this.checkChaturbate(stream.channel_name);
          break;
        case 'mfc':
          status = await this.checkMFC(stream.channel_name);
          break;
      }

      // Stub logic for now: if status changes, emit event
      if (status) {
        const wasLive = Boolean(stream.is_live);

        if (status.isLive && !wasLive) {
          // Stream went live
          updateStreamStatus(stream.id, true, Date.now());
          this.eventBus.emit('stream:live', { stream, status });
        } else if (!status.isLive && wasLive) {
          // Stream went offline
          updateStreamStatus(stream.id, false);
          this.eventBus.emit('stream:offline', { stream });
        }
      }
    } catch (error) {
      console.error(`Failed to check stream ${stream.platform}/${stream.channel_name}`, error);
    }
  }

  private async checkChaturbate(username: string): Promise<StreamStatus | null> {
    try {
      const profileUrl = `https://chaturbate.com/${username.toLowerCase()}/`;
      const response = await fetch(profileUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      });

      if (!response.ok) return null;

      const html = await response.text();
      const isLiveMatch = html.match(/"is_live":\s*true/i) || html.match(/\\u0022is_live\\u0022:\s*true/i);
      const isLive = !!isLiveMatch;

      return { isLive };
    } catch {
      return null;
    }
  }

  private async checkMFC(username: string): Promise<StreamStatus | null> {
    try {
      const profileUrl = `https://www.myfreecams.com/#${username.toLowerCase()}`;
      const response = await fetch(profileUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      });

      if (!response.ok) return null;

      const html = await response.text();
      const isLive =
        html.includes('class="model_online') || html.includes('"model_online"') || html.includes('player_online');

      return { isLive };
    } catch {
      return null;
    }
  }

  private async checkTwitch(username: string): Promise<StreamStatus | null> {
    return this.checkYtDlp(`https://twitch.tv/${username}`);
  }

  private async checkKick(username: string): Promise<StreamStatus | null> {
    return this.checkYtDlp(`https://kick.com/${username}`);
  }

  private async checkYtDlp(url: string): Promise<StreamStatus | null> {
    try {
      const { spawn } = await import('bun');
      // Run yt-dlp to check if live
      // --dump-json returns metadata if live, error if offline
      const proc = spawn(['yt-dlp', '--dump-json', '--no-warnings', url], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        // Offline or error
        return { isLive: false };
      }

      // If success, it's live
      // We could parse JSON for more info (title, viewers, etc.), but simply knowing it's live is enough for now
      // const text = await new Response(proc.stdout).text();
      // const meta = JSON.parse(text);

      return { isLive: true };
    } catch (e) {
      console.error(`yt-dlp check failed for ${url}`, e);
      return null;
    }
  }
}
