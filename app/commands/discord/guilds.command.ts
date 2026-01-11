/**
 * Discord Guilds Command - List all guilds the bot is in
 *
 * Usage: bun cli discord:guilds
 */

import { Command } from '@core';
import { Client, GatewayIntentBits } from 'discord.js';

export default class GuildsCommand extends Command {
  static override signature = `
    discord:guilds
    {--json : Output as JSON}
  `;

  static override description = 'List all Discord guilds (servers) the bot is in';

  async handle(): Promise<number> {
    const asJson = this.option('json') as boolean;

    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      this.error('DISCORD_BOT_TOKEN not set in environment');
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

      const guilds = client.guilds.cache.map((guild) => ({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        ownerId: guild.ownerId,
        joinedAt: guild.joinedAt?.toISOString(),
      }));

      if (asJson) {
        console.log(JSON.stringify(guilds, null, 2));
      } else {
        this.success(`Found ${guilds.length} guild(s)`);
        console.log('');

        for (const guild of guilds) {
          console.log(`Guild: ${guild.name}`);
          console.log(`  ID: ${guild.id}`);
          console.log(`  Members: ${guild.memberCount}`);
          console.log(`  Joined: ${guild.joinedAt ?? 'Unknown'}`);
          console.log('');
        }
      }

      return 0;
    } catch (error) {
      this.error(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    } finally {
      client.destroy();
    }
  }
}
