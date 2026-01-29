/**
 * Discord Download Images Command - Download all images from a Discord channel
 *
 * Usage:
 *   bun cli discord:download-images --output ~/images --guild 123 --channel 456
 *   bun cli discord:download-images --immich --album "My Album" --guild 123 --channel 456
 *   bun cli discord:download-images -i --output ~/images
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Command, getBotConfig } from '@core';
import { spawn } from 'child_process';
import { ChannelType, Client, GatewayIntentBits, type Message, type TextChannel } from 'discord.js';
import path from 'path';
import * as readline from 'readline';
import { downloadFileCustom } from '../../../app/helpers/media/utils/fileUtils';
import { ImmichClient } from '../../../core/immich/immich-client';

const BATCH_SIZE = 100;
const RATE_LIMIT_DELAY = 1000;

interface ImageInfo {
  url: string;
  filename: string;
  source: 'attachment' | 'embed';
  attachmentId?: string; // For attachments, use their unique ID instead of message ID
}

export default class DownloadImagesCommand extends Command {
  static override signature = `
    discord:download-images
    {--i|interactive : Interactive mode - select guild/channel}
    {--g|guild= : Guild ID (required if not interactive)}
    {--c|channel= : Channel ID (required if not interactive)}
    {--o|output=./downloads : Output directory (for disk mode)}
    {--album= : Immich album name (required for Immich mode)}
    {--immich : Upload to Immich instead of disk}
    {--no-archive : Don't archive Immich uploads (show in timeline)}
    {--limit= : Limit number of images to process (for testing)}
    {--config=config/config.ts : Path to config file}
  `;

  static override description = 'Download all images from a Discord channel to disk or Immich';

  private stats = {
    messages: 0,
    imagesFound: 0,
    imagesDownloaded: 0,
    imagesSkipped: 0,
    imagesFailed: 0,
    totalBytes: 0,
  };

  private tempDir: string | null = null;
  private rl?: readline.Interface;
  private immichClient?: ImmichClient;

  async handle(): Promise<number> {
    const interactive = this.option('interactive') as boolean;
    let guildId = this.option('guild') as string | undefined;
    let channelId = this.option('channel') as string | undefined;
    const outputDir = this.option('output') as string;
    const albumName = this.option('album') as string | undefined;
    const useImmich = this.option('immich') as boolean;
    const noArchive = this.option('no-archive') as boolean;
    const limitOption = this.option('limit') as string | undefined;
    const limit = limitOption ? parseInt(limitOption, 10) : undefined;

    const token = getBotConfig()?.tokens?.discord;
    if (!token) {
      this.error('Discord token not configured in config file');
      return 1;
    }

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    });

    try {
      if (interactive) {
        this.info('Connecting to Discord...');
        await client.login(token);
        await this.waitForReady(client);
        this.success(`Connected as ${client.user?.tag}\n`);

        const result = await this.runInteractiveMode(client, useImmich);
        if (!result) {
          this.info('Cancelled.');
          return 0;
        }

        guildId = result.guildId;
        channelId = result.channelId;
      }

      if (!guildId || !channelId) {
        this.error('Guild ID and Channel ID are required');
        return 1;
      }

      const mode = useImmich ? 'Immich' : 'Disk';
      this.info(`Mode: ${mode}`);
      this.info(`Guild: ${guildId}`);
      this.info(`Channel: ${channelId}`);
      if (limit) {
        this.info(`Limit: ${limit} images`);
      }

      if (useImmich) {
        if (!albumName) {
          this.error('--album is required when using --immich');
          return 1;
        }
        this.info(`Album: ${albumName}`);
        this.info(`Archive uploads: ${noArchive ? 'No (visible in timeline)' : 'Yes (hidden from timeline)'}`);

        this.immichClient = new ImmichClient();
        if (!this.immichClient.isReady()) {
          this.error('Immich is not enabled or configured');
          return 1;
        }
      } else {
        this.info(`Output directory: ${outputDir}`);
        await mkdir(outputDir, { recursive: true });
      }

      if (!client.isReady()) {
        this.info('Connecting to Discord...');
        await client.login(token);
        await this.waitForReady(client);
        this.success(`Connected as ${client.user?.tag}`);
        console.log('');
      }

      const guild = await client.guilds.fetch(guildId);
      if (!guild) {
        this.error(`Guild not found: ${guildId}`);
        return 1;
      }

      this.info(`Guild: ${guild.name}`);

      const channel = await guild.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
        this.error(`Channel not found or not a text channel: ${channelId}`);
        return 1;
      }

      this.info(`Channel: #${channel.name}`);
      console.log('');

      if (useImmich) {
        await this.createTempDirectory();
      }

      await this.processChannel(channel as TextChannel, guild.name, outputDir, albumName, useImmich, !noArchive, limit);

      this.success('\n✓ Complete!');
      console.log(`  Messages processed: ${this.stats.messages}`);
      console.log(`  Images found: ${this.stats.imagesFound}`);
      console.log(`  Images downloaded: ${this.stats.imagesDownloaded}`);
      console.log(`  Images skipped: ${this.stats.imagesSkipped}`);
      console.log(`  Images failed: ${this.stats.imagesFailed}`);
      if (this.stats.totalBytes > 0) {
        console.log(`  Total size: ${(this.stats.totalBytes / 1024 / 1024).toFixed(2)} MB`);
      }

      return 0;
    } catch (error) {
      this.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    } finally {
      await this.cleanup();
      client.destroy();
    }
  }

  private async processChannel(
    channel: TextChannel,
    guildName: string,
    outputDir: string,
    albumName: string | undefined,
    useImmich: boolean,
    archive: boolean,
    limit?: number,
  ): Promise<void> {
    let lastMessageId: string | undefined;
    let reachedEnd = false;
    let processedImages = 0;

    try {
      while (!reachedEnd) {
        const messages = await channel.messages.fetch({
          limit: BATCH_SIZE,
          ...(lastMessageId ? { before: lastMessageId } : {}),
        });

        if (messages.size === 0) break;

        for (const message of messages.values()) {
          // Check if we've hit the limit
          if (limit && processedImages >= limit) {
            reachedEnd = true;
            break;
          }

          this.stats.messages++;
          const images = this.extractImages(message);

          if (images.length > 0) {
            this.stats.imagesFound += images.length;

            for (const image of images) {
              // Check limit again for each image
              if (limit && processedImages >= limit) {
                reachedEnd = true;
                break;
              }

              await this.processImage(image, message, outputDir, albumName, guildName, useImmich, archive);
              processedImages++;
            }
          }

          process.stdout.write(
            `\rMessages: ${this.stats.messages}, Images: ${this.stats.imagesFound}, Downloaded: ${this.stats.imagesDownloaded}, Skipped: ${this.stats.imagesSkipped}, Failed: ${this.stats.imagesFailed}${limit ? `, Limit: ${processedImages}/${limit}` : ''}       `,
          );
        }

        if (reachedEnd) break;

        lastMessageId = messages.last()?.id;

        if (messages.size === BATCH_SIZE) {
          await this.sleep(RATE_LIMIT_DELAY);
        }
      }

      console.log('');
    } catch (error) {
      this.error(`\nError processing channel: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private extractImages(message: Message): ImageInfo[] {
    const images: ImageInfo[] = [];

    for (const [id, attachment] of message.attachments.entries()) {
      if (attachment.contentType && attachment.contentType.startsWith('image/')) {
        // Use proxyURL instead of direct URL for more reliable downloads
        images.push({
          url: attachment.proxyURL,
          filename: attachment.name || 'image',
          source: 'attachment',
          attachmentId: id,
        });
      }
    }

    for (const embed of message.embeds) {
      if (embed.image) {
        // Prefer proxyURL for more reliable downloads (Discord's cached CDN)
        const url = embed.image.proxyURL || embed.image.url;
        if (url) {
          images.push({
            url,
            filename: this.getFilenameFromUrl(url) || 'image.png',
            source: 'embed',
          });
        }
      }
    }

    return images;
  }

  private async processImage(
    image: ImageInfo,
    message: Message,
    outputDir: string,
    albumName: string | undefined,
    guildName: string,
    useImmich: boolean,
    archive: boolean,
  ): Promise<void> {
    const prefix = image.attachmentId || message.id;
    const filename = `${prefix}_${image.filename}`;

    try {
      if (useImmich) {
        await this.uploadToImmich(image, message, filename, albumName!, guildName, archive);
      } else {
        await this.downloadToDisk(image, message, filename, outputDir);
      }

      this.stats.imagesDownloaded++;
    } catch (error) {
      this.stats.imagesFailed++;
    }
  }

  private async downloadToDisk(image: ImageInfo, message: Message, filename: string, outputDir: string): Promise<void> {
    const outputPath = path.join(outputDir, filename);

    try {
      const exists = await this.fileExists(outputPath);
      if (exists) {
        this.stats.imagesSkipped++;
        return;
      }

      await downloadFileCustom(image.url, outputPath, message.createdAt);

      const stats = await stat(outputPath);
      this.stats.totalBytes += stats.size;
    } catch (error) {
      console.error(`\nError downloading ${filename}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async uploadToImmich(
    image: ImageInfo,
    message: Message,
    filename: string,
    albumName: string,
    guildName: string,
    archive: boolean,
  ): Promise<void> {
    if (!this.tempDir) {
      throw new Error('Temp directory not initialized');
    }

    const tempPath = path.join(this.tempDir, filename);

    try {
      // Step 1: Download to temp
      await downloadFileCustom(image.url, tempPath);

      // Step 2: Upload to Immich
      const stats = fs.statSync(tempPath);

      // Validate file is not empty
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty');
      }

      // Validate minimum size (images should be at least 1KB)
      if (stats.size < 1024) {
        throw new Error(`File too small (${stats.size} bytes), likely corrupted`);
      }

      // Validate it's actually an image
      const isValidImage = await this.validateImageFile(tempPath);
      if (!isValidImage) {
        throw new Error('File is not a valid image');
      }

      this.stats.totalBytes += stats.size;

      const description = this.buildDescription(message, guildName);

      const result = await this.immichClient!.uploadAsset(
        tempPath,
        message.createdAt,
        description,
        archive ? 'archive' : 'timeline',
      );

      if (result && albumName) {
        const channelName = (message.channel as TextChannel).name;
        const albumId = await this.immichClient!.ensureAlbum(albumName, `Images from #${channelName} in ${guildName}`);
        if (albumId) {
          await this.immichClient!.addAssetToAlbum(albumId, result.id);
        }
      }

      // Step 4: Delete temp file
      await unlink(tempPath);
    } catch (error) {
      console.error(`\nError uploading ${filename}: ${error instanceof Error ? error.message : String(error)}`);

      try {
        await unlink(tempPath);
      } catch {}

      throw error;
    }
  }

  private buildDescription(message: Message, guildName: string): string {
    const author = message.author.username;
    const date = message.createdAt.toLocaleString();
    const content = message.content.trim() || '(no text)';
    const truncatedContent = content.length > 500 ? content.substring(0, 500) + '...' : content;
    const messageUrl = `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;

    return `Posted by @${author} on ${date}\n\n${truncatedContent}\n\nSource: ${messageUrl}\nServer: ${guildName}`;
  }

  private async validateImageFile(filePath: string): Promise<boolean> {
    try {
      const proc = spawn('file', [filePath]);
      let output = '';
      let errorOutput = '';

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      return new Promise((resolve) => {
        proc.on('close', (code) => {
          if (code !== 0) {
            console.warn(`file command failed: ${errorOutput}`);
            resolve(false);
            return;
          }

          const type = output.toLowerCase();
          const isImage =
            type.includes('png') ||
            type.includes('jpeg') ||
            type.includes('jpg') ||
            type.includes('gif') ||
            type.includes('webp') ||
            type.includes('bmp') ||
            type.includes('svg');

          if (!isImage) {
            console.warn(`File is not a valid image: ${output.trim()}`);
          }

          resolve(isImage);
        });
      });
    } catch {
      return false;
    }
  }

  private getFilenameFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const parts = pathname.split('/');
      const filename = parts[parts.length - 1];
      return filename || null;
    } catch {
      return null;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async createTempDirectory(): Promise<void> {
    const uniqueId = randomUUID();
    this.tempDir = path.join(tmpdir(), 'discord-image-fetcher', uniqueId);
    await mkdir(this.tempDir, { recursive: true });
  }

  private async cleanup(): Promise<void> {
    if (this.tempDir) {
      try {
        await unlink(this.tempDir);
      } catch {}
      this.tempDir = null;
    }
  }

  private async waitForReady(client: Client): Promise<void> {
    if (client.isReady()) return;
    await new Promise<void>((resolve) => {
      client.once('ready', () => resolve());
    });
  }

  private async runInteractiveMode(
    client: Client,
    useImmich: boolean,
  ): Promise<{
    guildId?: string;
    channelId?: string;
  } | null> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      const guilds = Array.from(client.guilds.cache.values());
      console.log('\n📁 Select a guild:');
      for (let i = 0; i < guilds.length; i++) {
        const g = guilds[i]!;
        console.log(`  ${i + 1}) ${g.name} (${g.memberCount} members)`);
      }

      const guildChoice = await this.prompt(`\nEnter choice [1-${guilds.length}]: `);
      if (guildChoice === null) return null;

      const guildIndex = parseInt(guildChoice, 10);
      if (Number.isNaN(guildIndex) || guildIndex < 1 || guildIndex > guilds.length) {
        this.error('Invalid choice');
        return null;
      }

      const selectedGuild = guilds[guildIndex - 1]!;

      const channels = Array.from(
        selectedGuild.channels.cache
          .filter((ch) => ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)
          .values(),
      ) as TextChannel[];

      channels.sort((a, b) => a.name.localeCompare(b.name));

      console.log(`\n📝 Select a channel in ${selectedGuild.name}:`);
      for (let i = 0; i < channels.length; i++) {
        console.log(`  ${i + 1}) #${channels[i]!.name}`);
      }

      const channelChoice = await this.prompt(`\nEnter choice [1-${channels.length}]: `);
      if (channelChoice === null) return null;

      const channelIndex = parseInt(channelChoice, 10);
      if (Number.isNaN(channelIndex) || channelIndex < 1 || channelIndex > channels.length) {
        this.error('Invalid choice');
        return null;
      }

      const selectedChannel = channels[channelIndex - 1]!;

      let albumName: string | undefined;
      if (useImmich) {
        const albumInput = await this.prompt('\n📁 Enter album name: ');
        if (albumInput === null || !albumInput.trim()) {
          this.error('Album name is required');
          return null;
        }
        albumName = albumInput.trim();
      }

      console.log(`\n${'─'.repeat(40)}`);
      console.log('Summary:');
      console.log(`  Guild: ${selectedGuild.name}`);
      console.log(`  Channel: #${selectedChannel.name}`);
      if (albumName) {
        console.log(`  Album: ${albumName}`);
      }
      console.log('─'.repeat(40));

      const confirm = await this.prompt('\nProceed? [Y/n]: ');
      if (confirm === null || confirm.toLowerCase() === 'n') {
        return null;
      }

      return {
        guildId: selectedGuild.id,
        channelId: selectedChannel.id,
      };
    } finally {
      this.rl.close();
      this.rl = undefined;
    }
  }

  private prompt(question: string): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.rl) {
        resolve(null);
        return;
      }
      this.rl.question(question, (answer) => {
        resolve(answer);
      });
      this.rl.once('close', () => resolve(null));
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
