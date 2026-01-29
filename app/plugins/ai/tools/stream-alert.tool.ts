/**
 * Stream Alert Tool - Manage stream alerts
 */

import { addSubscription, getSubscriptions, removeSubscription } from '@core/database/streams';
import type { Tool, ToolExecutionContext, ToolMetadata, ToolResult, ToolSchema } from '@core/types/tool';

export class StreamAlertTool implements Tool {
  readonly metadata: ToolMetadata = {
    name: 'stream_alert',
    description: 'Manage stream alerts (add/remove/list) for Twitch, Kick, Chaturbate, MFC',
    version: '1.0.0',
    author: 'SARA',
    keywords: ['stream', 'alert', 'twitch', 'kick', 'live'],
    category: 'utility',
    priority: 5,
  };

  readonly schema: ToolSchema = {
    type: 'function',
    name: 'stream_alert',
    description: 'Manage stream alerts. You can add, remove, or list alerts for varying platforms.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'remove', 'list'],
          description: 'Action to perform',
        },
        platform: {
          type: 'string',
          enum: ['twitch', 'kick', 'chaturbate', 'mfc'],
          description: 'Streaming platform',
        },
        channel: {
          type: 'string',
          description: 'Channel name or ID (required for add/remove)',
        },
      },
      required: ['action'],
    },
  };

  validate(): boolean {
    return true;
  }

  async execute(args: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    const params = args as {
      action: 'add' | 'remove' | 'list';
      platform?: string;
      channel?: string;
    };

    const guildId = context.channel.guildId || 'dm';

    if (params.action === 'list') {
      const subs = getSubscriptions(params.platform); // Filter by platform if provided
      // Filter by guild/context if needed, though getSubscriptions gets all
      const guildSubs = subs.filter((s) => s.guild_id === guildId);

      if (guildSubs.length === 0) {
        return { success: true, data: 'No stream alerts set up for this server.' };
      }

      const list = guildSubs.map((s) => `- **${s.platform}**: ${s.channel_name}`).join('\n');
      return { success: true, data: `**Stream Alerts:**\n${list}` };
    }

    if (!params.platform || !params.channel) {
      return {
        success: false,
        error: {
          type: 'validation_error',
          message: 'Platform and channel are required for add/remove actions.',
        },
      };
    }

    if (params.action === 'add') {
      try {
        addSubscription({
          platform: params.platform,
          channelId: params.channel, // In a real app we'd resolve ID from name
          channelName: params.channel,
          addedBy: 'user', // Context doesn't always provide user ID yet in this stub
          guildId,
        });
        return { success: true, data: `✅ Added alert for ${params.platform}/${params.channel}` };
      } catch (error) {
        return {
          success: false,
          error: {
            type: 'execution_error',
            message: `Failed to add alert: ${error}`,
          },
        };
      }
    }

    if (params.action === 'remove') {
      const removed = removeSubscription(params.platform, params.channel, guildId);
      if (removed) {
        return { success: true, data: `🗑️ Removed alert for ${params.platform}/${params.channel}` };
      }
      return {
        success: false,
        error: {
          type: 'not_found',
          message: 'Subscription not found.',
        },
      };
    }

    return {
      success: false,
      error: {
        type: 'validation_error',
        message: 'Invalid action',
      },
    };
  }
}
