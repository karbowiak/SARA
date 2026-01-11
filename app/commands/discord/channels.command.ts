/**
 * Discord Channels Command - List all channels the bot can see
 *
 * Usage: bun cli discord:channels [--guild=<id>]
 */

import { Command, getBotConfig } from '@core';
import { ChannelType, Client, GatewayIntentBits } from 'discord.js';

export default class ChannelsCommand extends Command {
  static override signature = `
    discord:channels
    {--guild= : Filter to a specific guild ID}
    {--json : Output as JSON}
  `;

  static override description = 'List all Discord channels the bot can see, grouped by guild';

  async handle(): Promise<number> {
    const guildFilter = this.option('guild') as string | undefined;
    const asJson = this.option('json') as boolean;

    const token = getBotConfig()?.tokens?.discord;
    if (!token) {
      this.error('Discord token not configured in config file');
      return 1;
    }

    const client = new Client({
      intents: [GatewayIntentBits.Guilds],
    });

    try {
      this.info('Connecting to Discord...');
      await client.login(token);

      // Wait for client to be ready
      await new Promise<void>((resolve) => {
        if (client.isReady()) {
          resolve();
        } else {
          client.once('clientReady', () => resolve());
        }
      });

      const result: Array<{
        guild: { id: string; name: string };
        channels: Array<{ id: string; name: string; type: string }>;
      }> = [];

      const guilds = guildFilter ? client.guilds.cache.filter((g) => g.id === guildFilter) : client.guilds.cache;

      if (guilds.size === 0) {
        if (guildFilter) {
          this.error(`Guild not found: ${guildFilter}`);
        } else {
          this.warning('Bot is not in any guilds');
        }
        return 1;
      }

      for (const guild of guilds.values()) {
        const textChannels = guild.channels.cache
          .filter(
            (ch) =>
              ch.type === ChannelType.GuildText ||
              ch.type === ChannelType.GuildAnnouncement ||
              ch.type === ChannelType.PublicThread ||
              ch.type === ChannelType.PrivateThread,
          )
          .map((ch) => ({
            id: ch.id,
            name: ch.name,
            type: this.getChannelTypeName(ch.type),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        result.push({
          guild: { id: guild.id, name: guild.name },
          channels: textChannels,
        });
      }

      if (asJson) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        let totalChannels = 0;

        for (const entry of result) {
          console.log(`\nGuild: ${entry.guild.name} (${entry.guild.id})`);
          console.log('─'.repeat(50));

          if (entry.channels.length === 0) {
            console.log('  No text channels accessible');
          } else {
            for (const channel of entry.channels) {
              const typeTag = channel.type !== 'text' ? ` [${channel.type}]` : '';
              console.log(`  #${channel.name} (${channel.id})${typeTag}`);
            }
          }

          totalChannels += entry.channels.length;
        }

        console.log('');
        this.success(`Found ${totalChannels} channel(s) across ${result.length} guild(s)`);
      }

      return 0;
    } catch (error) {
      this.error(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    } finally {
      client.destroy();
    }
  }

  private getChannelTypeName(type: ChannelType): string {
    switch (type) {
      case ChannelType.GuildText:
        return 'text';
      case ChannelType.GuildAnnouncement:
        return 'announcement';
      case ChannelType.PublicThread:
        return 'thread';
      case ChannelType.PrivateThread:
        return 'private-thread';
      default:
        return 'unknown';
    }
  }
}
