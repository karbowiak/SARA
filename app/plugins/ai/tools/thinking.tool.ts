/**
 * Thinking Tool
 *
 * Elevates complex problems to a more powerful reasoning model with extended thinking.
 *
 * Use this for:
 * - Complex multi-step problems
 * - Deep analysis requiring reasoning
 * - Questions that need careful consideration
 * - Problems that benefit from breaking down into steps
 */

import type { Tool, ToolExecutionContext, ToolMetadata, ToolResult, ToolSchema } from '@core';
import { getBotConfig } from '@core';
import { z } from 'zod';

interface ThinkingArgs {
  problem: string;
  context?: string;
}

export class ThinkingTool implements Tool {
  readonly metadata: ToolMetadata = {
    name: 'think_deeply',
    description: 'Use advanced reasoning to solve complex problems',
    version: '1.0.0',
    author: 'system',
    keywords: [
      'think',
      'reason',
      'analyze',
      'complex',
      'difficult',
      'deep',
      'thorough',
      'careful',
      'consider',
      'problem',
      'solve',
      'logic',
      'reasoning',
      'analysis',
      'figure out',
      'work through',
      'break down',
      'step by step',
      'elaborate',
      'detailed',
    ],
    category: 'utility',
    priority: 8,
  };

  readonly schema: ToolSchema = {
    type: 'function',
    name: 'think_deeply',
    description:
      'Elevate to a more powerful reasoning model to think through complex problems step-by-step. ' +
      'Use this for:\n' +
      '- Multi-step problems requiring careful analysis\n' +
      '- Questions needing deep reasoning or logic\n' +
      '- Complex research or calculations\n' +
      '- Problems where breaking down into steps would help',
    parameters: {
      type: 'object',
      properties: {
        problem: {
          type: 'string',
          description:
            'The complex problem or question to reason through. Be specific and include all relevant context.',
        },
        context: {
          type: 'string',
          description:
            'Additional context that might help (optional). Include relevant background, constraints, or preferences.',
        },
      },
      required: ['problem'],
      additionalProperties: false,
    },
    strict: true,
  };

  /**
   * Validate that OpenRouter API key is available
   */
  validate(): boolean {
    const config = getBotConfig();
    return !!config?.tokens?.openrouter;
  }

  // Zod schema for input validation
  private readonly argsSchema = z.object({
    problem: z.string().min(1).max(5000),
    context: z.string().max(5000).optional(),
  });

  async execute(args: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    // Validate input
    const parseResult = this.argsSchema.safeParse(args);
    if (!parseResult.success) {
      return {
        success: false,
        error: {
          type: 'validation_error',
          message: `Invalid parameters: ${parseResult.error.message}`,
        },
      };
    }

    const config = getBotConfig();
    const apiKey = config?.tokens?.openrouter;

    if (!apiKey) {
      return {
        success: false,
        error: {
          type: 'configuration_error',
          message: 'OpenRouter API key is not configured',
        },
      };
    }

    try {
      const params = parseResult.data;
      const { problem, context: additionalContext } = params;

      // Use a reasoning model - defaults to o1-mini
      const thinkingModel = config?.ai?.reasoningModel ?? 'openai/o1-mini';

      context.logger.info('[ThinkingTool] Starting deep reasoning', {
        problemLength: problem.length,
        hasContext: !!additionalContext,
        userId: context.user.id,
        model: thinkingModel,
      });

      // Build the thinking prompt
      let thinkingPrompt = `Think through this problem carefully and thoroughly.\n\nProblem: ${problem}\n`;

      if (additionalContext) {
        thinkingPrompt += `\nAdditional Context: ${additionalContext}\n`;
      }

      thinkingPrompt += `\nProvide a well-reasoned analysis with clear step-by-step thinking where appropriate.`;

      // Get base URL from config
      const baseUrl = config.ai?.openRouterBaseUrl ?? 'https://openrouter.ai/api/v1';

      // Call the reasoning model via OpenRouter
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/karbowiak/SARA',
        },
        body: JSON.stringify({
          model: thinkingModel,
          messages: [
            {
              role: 'user',
              content: thinkingPrompt,
            },
          ],
          max_tokens: 4000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      };

      const responseText = data.choices?.[0]?.message?.content;

      if (!responseText) {
        throw new Error('No response from reasoning model');
      }

      context.logger.info('[ThinkingTool] Deep reasoning complete', {
        responseLength: responseText.length,
        userId: context.user.id,
      });

      return {
        success: true,
        data: {
          problem,
          reasoning: responseText,
          model: thinkingModel,
        },
        message: `🧠 **Deep Reasoning Analysis:**\n\n${responseText}`,
      };
    } catch (error) {
      context.logger.error('[ThinkingTool] Reasoning failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: {
          type: 'execution_error',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
