/**
 * Stream Plugin - Registers stream monitoring
 */

import type { PluginContext, TimerHandlerPlugin } from '../../../core/types/plugin';
import { StreamService } from './stream.service';

export class StreamPlugin implements TimerHandlerPlugin {
  readonly id = 'stream';
  readonly name = 'Stream Plugin';
  readonly type = 'timer';
  readonly description = 'Stream monitoring and alerts';
  readonly version = '1.0.0';
  readonly author = 'SARA';

  readonly timerConfig = {
    intervalMs: 2 * 60 * 1000, // 2 minutes
    runImmediately: true,
  };

  private context?: PluginContext;
  private service?: StreamService;

  async load(context: PluginContext): Promise<void> {
    this.context = context;
    this.service = new StreamService(context.eventBus);

    // We don't need manual start() anymore, the system calls tick()
    // this.service.start();

    context.logger.info('StreamPlugin loaded');
  }

  async tick(context: PluginContext): Promise<void> {
    if (this.service) {
      await this.service.checkStreams();
    }
  }

  async unload(): Promise<void> {
    this.context?.logger.info('StreamPlugin unloaded');
    // this.service?.stop(); // No manual stop needed
  }
}
