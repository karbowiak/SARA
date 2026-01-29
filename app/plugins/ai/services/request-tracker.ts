import type { Logger } from '@core';
import { localCosineSimilarity, localEmbed } from '@core/local-embedder';

export interface PendingRequest {
  id: string;
  channelId: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  embedding: Float32Array;
  startedAt: number;
  messageId: string;
}

export class RequestTracker {
  private pending = new Map<string, PendingRequest[]>();
  private cleanupInterval?: NodeJS.Timeout;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
    // Start cleanup timer (every 30s, removes requests >2min old)
    this.cleanupInterval = setInterval(() => this.cleanupStale(), 30000);
  }

  /**
   * Add a pending request and generate its embedding for similarity matching
   * @returns Request ID for later removal
   */
  async addPending(channelId: string, tool: string, args: Record<string, unknown>, messageId: string): Promise<string> {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Generate summary (tool name + first 80 chars of main arg)
    const summary = this.generateSummary(tool, args);

    // Generate embedding for similarity matching
    const embedding = await localEmbed(summary);

    const request: PendingRequest = {
      id,
      channelId,
      tool,
      args,
      summary,
      embedding,
      startedAt: Date.now(),
      messageId,
    };

    const channelRequests = this.pending.get(channelId) || [];
    channelRequests.push(request);
    this.pending.set(channelId, channelRequests);

    this.logger.debug('[RequestTracker] Added pending request', {
      id,
      channelId,
      tool,
      summary: summary.slice(0, 100),
    });

    return id;
  }

  /**
   * Remove a completed request
   */
  removePending(channelId: string, requestId: string): void {
    const channelRequests = this.pending.get(channelId);
    if (!channelRequests) return;

    const filtered = channelRequests.filter((r) => r.id !== requestId);
    if (filtered.length === 0) {
      this.pending.delete(channelId);
    } else {
      this.pending.set(channelId, filtered);
    }

    this.logger.debug('[RequestTracker] Removed pending request', { requestId, channelId });
  }

  /**
   * Find a similar pending request (similarity > 0.85)
   * @returns The most similar request, or null if none found
   */
  async findSimilar(channelId: string, tool: string, args: Record<string, unknown>): Promise<PendingRequest | null> {
    const channelRequests = this.pending.get(channelId);
    if (!channelRequests || channelRequests.length === 0) return null;

    // Filter by tool first
    const sameToolRequests = channelRequests.filter((r) => r.tool === tool);
    if (sameToolRequests.length === 0) return null;

    // Generate embedding for comparison
    const summary = this.generateSummary(tool, args);
    const queryEmbedding = await localEmbed(summary);

    // Find most similar request above threshold (0.85)
    const SIMILARITY_THRESHOLD = 0.85;
    let mostSimilar: PendingRequest | null = null;
    let highestSimilarity = SIMILARITY_THRESHOLD;

    for (const req of sameToolRequests) {
      const similarity = localCosineSimilarity(queryEmbedding, req.embedding);
      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
        mostSimilar = req;
      }
    }

    if (mostSimilar) {
      this.logger.info('[RequestTracker] Found similar request', {
        similarity: highestSimilarity.toFixed(3),
        existing: mostSimilar.summary.slice(0, 80),
        new: summary.slice(0, 80),
      });
    }

    return mostSimilar;
  }

  /**
   * Get all pending requests for a channel
   */
  getPendingForChannel(channelId: string): PendingRequest[] {
    return this.pending.get(channelId) || [];
  }

  /**
   * Remove stale requests (older than 2 minutes)
   */
  private cleanupStale(): void {
    const now = Date.now();
    const STALE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

    let removedCount = 0;
    for (const [channelId, requests] of this.pending.entries()) {
      const filtered = requests.filter((r) => now - r.startedAt < STALE_TIMEOUT_MS);
      removedCount += requests.length - filtered.length;

      if (filtered.length === 0) {
        this.pending.delete(channelId);
      } else {
        this.pending.set(channelId, filtered);
      }
    }

    if (removedCount > 0) {
      this.logger.debug('[RequestTracker] Cleaned up stale requests', { removedCount });
    }
  }

  /**
   * Generate human-readable summary from tool args
   */
  private generateSummary(tool: string, args: Record<string, unknown>): string {
    // For image_generation: use prompt (first 80 chars)
    if (tool === 'image_generation') {
      const prompt = (args.prompt as string) || 'unknown';
      return `generating image: ${prompt.slice(0, 80)}`;
    }

    // Generic fallback
    const mainArg = Object.values(args)[0] as string;
    return `${tool}: ${String(mainArg).slice(0, 80)}`;
  }

  /**
   * Clean up resources (stop cleanup interval)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.pending.clear();
  }
}
