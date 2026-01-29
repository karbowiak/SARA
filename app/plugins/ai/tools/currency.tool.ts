/**
 * Currency Conversion Tool
 *
 * Converts between currencies using real-time exchange rates.
 * Uses ExchangeRate-API's free endpoint (no API key required).
 */

import type { Tool, ToolExecutionContext, ToolMetadata, ToolResult, ToolSchema } from '@core';
import { z } from 'zod';

// Common currency codes for the enum
const _COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'AUD',
  'CAD',
  'CHF',
  'CNY',
  'SEK',
  'NOK',
  'DKK',
  'NZD',
  'SGD',
  'HKD',
  'KRW',
  'INR',
  'BRL',
  'MXN',
  'ZAR',
  'RUB',
  'PLN',
  'CZK',
  'HUF',
  'TRY',
  'THB',
] as const;

interface ExchangeRateResponse {
  result: string;
  base_code: string;
  rates: Record<string, number>;
  time_last_update_utc: string;
}

// Cache exchange rates to avoid hitting API too frequently
const rateCache = new Map<string, { rates: Record<string, number>; timestamp: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

export class CurrencyTool implements Tool {
  readonly metadata: ToolMetadata = {
    name: 'currency_convert',
    description: 'Convert between currencies using real-time exchange rates',
    version: '1.0.0',
    author: 'system',
    keywords: ['currency', 'convert', 'exchange', 'money', 'forex'],
    category: 'utility',
    priority: 5,
  };

  readonly schema: ToolSchema = {
    type: 'function',
    name: 'currency_convert',
    description:
      'Convert an amount from one currency to another using real-time exchange rates. ' +
      'Supports all major world currencies (ISO 4217 codes). ' +
      'Examples: USD to EUR, GBP to JPY, etc.',
    parameters: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'The amount to convert',
        },
        from: {
          type: 'string',
          description: 'Source currency code (ISO 4217, e.g., USD, EUR, GBP)',
        },
        to: {
          type: 'string',
          description: 'Target currency code (ISO 4217, e.g., USD, EUR, GBP)',
        },
      },
      required: ['amount', 'from', 'to'],
      additionalProperties: false,
    },
    strict: true,
  };

  // Zod schema for input validation
  private readonly argsSchema = z.object({
    amount: z.number().positive().finite(),
    from: z.string().min(3).max(3).toUpperCase(),
    to: z.string().min(3).max(3).toUpperCase(),
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

    const { amount, from, to } = parseResult.data;

    // Normalize currency codes to uppercase
    const fromCurrency = from.toUpperCase().trim();
    const toCurrency = to.toUpperCase().trim();

    context.logger.debug('[CurrencyTool] Converting', { amount, from: fromCurrency, to: toCurrency });

    try {
      // Get exchange rates (from cache or API)
      const rates = await this.getExchangeRates(fromCurrency);

      if (!rates[toCurrency]) {
        return {
          success: false,
          error: {
            type: 'invalid_currency',
            message: `Unknown currency code: ${toCurrency}. Use ISO 4217 codes (e.g., USD, EUR, GBP).`,
          },
        };
      }

      const rate = rates[toCurrency];
      const converted = amount * rate;

      // Format nicely based on currency
      const formattedAmount = this.formatCurrency(amount, fromCurrency);
      const formattedConverted = this.formatCurrency(converted, toCurrency);

      return {
        success: true,
        data: {
          original: {
            amount,
            currency: fromCurrency,
            formatted: formattedAmount,
          },
          converted: {
            amount: Math.round(converted * 100) / 100,
            currency: toCurrency,
            formatted: formattedConverted,
          },
          rate: Math.round(rate * 10000) / 10000,
          rateDescription: `1 ${fromCurrency} = ${rate.toFixed(4)} ${toCurrency}`,
        },
      };
    } catch (error) {
      context.logger.error('[CurrencyTool] Conversion failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Check if it's an invalid base currency
      if (error instanceof Error && error.message.includes('unsupported-code')) {
        return {
          success: false,
          error: {
            type: 'invalid_currency',
            message: `Unknown currency code: ${fromCurrency}. Use ISO 4217 codes (e.g., USD, EUR, GBP).`,
          },
        };
      }

      return {
        success: false,
        error: {
          type: 'api_error',
          message: error instanceof Error ? error.message : 'Failed to fetch exchange rates',
          retryable: true,
        },
      };
    }
  }

  /**
   * Get exchange rates for a base currency (with caching)
   */
  private async getExchangeRates(baseCurrency: string): Promise<Record<string, number>> {
    // Check cache first
    const cached = rateCache.get(baseCurrency);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.rates;
    }

    // Fetch from API
    const response = await fetch(`https://open.er-api.com/v6/latest/${baseCurrency}`);

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as ExchangeRateResponse;

    if (data.result !== 'success') {
      throw new Error(`API returned error: ${data.result}`);
    }

    // Cache the rates
    rateCache.set(baseCurrency, {
      rates: data.rates,
      timestamp: Date.now(),
    });

    return data.rates;
  }

  /**
   * Format a currency amount with appropriate symbol/decimals
   */
  private formatCurrency(amount: number, currency: string): string {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      // Fallback for unknown currencies
      return `${amount.toFixed(2)} ${currency}`;
    }
  }
}
