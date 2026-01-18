/**
 * Robust Fetcher Helper
 *
 * Wraps the native fetch API with retry logic for transient errors.
 */

export interface FetcherOptions extends RequestInit {
  /** Number of retries (default: 3) */
  retries?: number;
  /** Initial delay before retry in ms (default: 1000) */
  retryDelay?: number;
  /** Request timeout in ms (default: 10000) */
  timeout?: number;
}

/**
 * Fetch with retry logic and timeout
 */
export async function fetcher(url: string | URL | Request, options: FetcherOptions = {}): Promise<Response> {
  const { retries = 3, retryDelay = 1000, timeout = 10000, ...fetchOptions } = options;

  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= retries) {
    try {
      const controller = new AbortController();
      const signal = options.signal ?? controller.signal;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          ...fetchOptions,
          signal,
        });

        // Clear timeout
        clearTimeout(timeoutId);

        // If successful or client error (4xx) that shouldn't be retried
        if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
          return response;
        }

        // If 429 (Too Many Requests) or 5xx (Server Error), throw to trigger retry
        throw new Error(`Request failed with status ${response.status}`);
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempt++;

      if (attempt > retries) {
        break;
      }

      // Exponential backoff with jitter
      const delay = retryDelay * 2 ** (attempt - 1) * (0.5 + Math.random() * 0.5);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error('Fetch failed');
}
