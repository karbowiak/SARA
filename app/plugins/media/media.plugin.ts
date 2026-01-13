/**
 * Media Plugin - Registers social media handlers and slash commands
 */

import type { BotMessage } from '../../../core/types/message';
import type { MessageHandlerPlugin, PluginContext } from '../../../core/types/plugin';
import { MediaService } from './media.service';

export class MediaPlugin implements MessageHandlerPlugin {
  readonly id = 'media';
  readonly name = 'Media Plugin';
  readonly type = 'message';
  readonly description = 'Social media content expansion and processing';
  readonly version = '1.0.0';
  readonly author = 'SARA';

  private context?: PluginContext;
  private service?: MediaService;

  async load(context: PluginContext): Promise<void> {
    this.context = context;
    this.service = new MediaService();

    // Register slash command
    context.commands.register({
      name: 'media',
      description: 'Download and display content from social media URLs',
      options: [
        {
          name: 'url',
          description: 'The URL to process (Instagram, TikTok, Reddit)',
          type: 'string',
          required: true,
        },
      ],
      handler: async (interaction) => {
        const url = interaction.options.getString('url', true);
        const platform = this.service?.getPlatform(url);

        if (!platform) {
          await interaction.reply({
            content: '❌ Unsupported platform. Currently supporting: Instagram, TikTok, Reddit.',
            ephemeral: true,
          });
          return;
        }

        await interaction.deferReply();

        try {
          const messages = (await this.service?.processMedia(url, platform)) ?? [];
          if (messages.length === 0) {
            await interaction.editReply('❌ Could not extract content from that URL.');
            return;
          }

          // Send first message
          await interaction.editReply({
            content: messages[0].content,
            files: messages[0].files,
          });

          // Send subsequent messages if split
          if (messages.length > 1 && messages[1]) {
            await interaction.channel?.send({
              content: messages[1].content,
              files: messages[1].files,
            });
          }
        } catch (error) {
          if (error instanceof Error && error.message === 'TikTok Live not supported') {
            await interaction.editReply({
              content: '❌ TikTok Live streams are not supported.',
            });
            return;
          }
          context.logger.error('Media command failed', { error, url });
          await interaction.editReply('❌ Failed to process media URL.');
        }
      },
    });

    context.logger.info('MediaPlugin loaded');
  }

  async unload(): Promise<void> {
    this.context?.logger.info('MediaPlugin unloaded');
  }

  async shouldHandle(message: BotMessage): Promise<boolean> {
    if (message.author.bot) return false;
    // Check for links to supported platforms
    const supportedDomains = ['instagram.com', 'tiktok.com', 'reddit.com', 'redd.it'];
    return supportedDomains.some((domain) => message.content.includes(domain));
  }

  async handle(message: BotMessage, context: PluginContext): Promise<void> {
    if (!this.service) return;

    // Extract URLs (simple regex for now)
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = message.content.match(urlRegex);
    if (!matches) return;

    for (const url of matches) {
      const platform = this.service.getPlatform(url);
      if (platform) {
        try {
          const messages = await this.service.processMedia(url, platform);
          if (messages.length > 0) {
            // Send each message
            for (const msg of messages) {
              await message.reply({ content: msg.content, files: msg.files });
            }
          }
        } catch (error) {
          // Silent fail on auto-expansion to avoid spam, but log it
          context.logger.debug('Failed to auto-expand media', { url, error });
        }
      }
    }
  }
}
