/**
 * Universal Webhook Helper
 *
 * Provides utilities for sending content via webhooks.
 * Supports Discord webhooks (with embeds/files) and generic HTTP webhooks.
 */

// ============================================================================
// Types
// ============================================================================

export interface WebhookPayload {
  /** Text content/message */
  content?: string;
  /** Discord-style embeds (only used for Discord webhooks) */
  embeds?: Array<{
    title?: string;
    description?: string;
    color?: number;
    image?: { url: string };
    footer?: { text: string };
  }>;
  /** File attachments */
  files?: Array<{
    name: string;
    data: Buffer | Uint8Array;
    contentType?: string;
  }>;
  /** Override webhook display name (Discord only) */
  username?: string;
  /** Override webhook avatar (Discord only) */
  avatarUrl?: string;
  /** Additional metadata for generic webhooks */
  metadata?: Record<string, unknown>;
}

export type WebhookType = 'discord' | 'generic';

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  type: WebhookType;
  categories: string[];
  isDefault?: boolean;
}

export interface WebhookResult {
  success: boolean;
  error?: string;
  /** HTTP status code if available */
  statusCode?: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Discord webhook URL pattern for auto-detection */
const DISCORD_WEBHOOK_PATTERN = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;

/**
 * Minimal valid PNG image (64x64 solid magenta square)
 * Used for testing webhooks
 */
const TEST_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAP0lEQVR4nO3BMQEAAADCoPVP' +
  'bQwfoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIC3AUTwAAGc95Rq' +
  'AAAAAElFTkSuQmCC';

// ============================================================================
// Detection & Validation
// ============================================================================

/**
 * Detect webhook type from URL
 */
export function detectWebhookType(url: string): WebhookType {
  if (DISCORD_WEBHOOK_PATTERN.test(url)) {
    return 'discord';
  }
  return 'generic';
}

/**
 * Validate that a URL is a valid HTTP(S) URL
 */
function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Send content to a webhook
 *
 * Automatically detects Discord webhooks and uses appropriate format.
 * For generic webhooks, sends JSON with file data as base64.
 *
 * @param webhookUrl - Full webhook URL
 * @param payload - Content to send
 * @param type - Optional webhook type override (auto-detected if not provided)
 * @returns Result indicating success or failure with error message
 */
export async function sendToWebhook(
  webhookUrl: string,
  payload: WebhookPayload,
  type?: WebhookType,
): Promise<WebhookResult> {
  // Validate URL format
  if (!isValidHttpUrl(webhookUrl)) {
    return {
      success: false,
      error: 'Invalid webhook URL. Must be a valid HTTP or HTTPS URL.',
    };
  }

  // Validate payload has content
  if (!payload.content && !payload.embeds?.length && !payload.files?.length && !payload.metadata) {
    return {
      success: false,
      error: 'Payload must contain at least one of: content, embeds, files, or metadata',
    };
  }

  // Auto-detect type if not specified
  const webhookType = type ?? detectWebhookType(webhookUrl);

  try {
    let response: Response;

    if (webhookType === 'discord') {
      response = await sendToDiscord(webhookUrl, payload);
    } else {
      response = await sendToGeneric(webhookUrl, payload);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      return {
        success: false,
        error: `Webhook error (${response.status}): ${errorBody}`,
        statusCode: response.status,
      };
    }

    return { success: true, statusCode: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to send webhook: ${message}`,
    };
  }
}

/**
 * Send a test message to verify webhook connectivity
 *
 * @param webhookUrl - Full webhook URL
 * @param botName - Name of the bot for the test message
 * @param type - Optional webhook type override
 * @returns Result indicating success or failure
 */
export async function testWebhook(webhookUrl: string, botName: string, type?: WebhookType): Promise<WebhookResult> {
  const imageData = Buffer.from(TEST_IMAGE_BASE64, 'base64');

  const payload: WebhookPayload = {
    content: `🧪 Webhook test from ${botName}`,
    files: [
      {
        name: 'test-image.png',
        data: imageData,
        contentType: 'image/png',
      },
    ],
    metadata: {
      test: true,
      timestamp: new Date().toISOString(),
      botName,
    },
  };

  return sendToWebhook(webhookUrl, payload, type);
}

// ============================================================================
// Discord Webhook
// ============================================================================

/**
 * Send payload to Discord webhook
 */
async function sendToDiscord(webhookUrl: string, payload: WebhookPayload): Promise<Response> {
  if (payload.files && payload.files.length > 0) {
    return sendDiscordWithFiles(webhookUrl, payload);
  }
  return sendDiscordJson(webhookUrl, payload);
}

/**
 * Send Discord payload as JSON (no files)
 */
async function sendDiscordJson(webhookUrl: string, payload: WebhookPayload): Promise<Response> {
  const body: Record<string, unknown> = {};

  if (payload.content) {
    body.content = payload.content;
  }

  if (payload.embeds?.length) {
    body.embeds = payload.embeds;
  }

  if (payload.username) {
    body.username = payload.username;
  }

  if (payload.avatarUrl) {
    body.avatar_url = payload.avatarUrl;
  }

  return fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Send Discord payload with files using multipart/form-data
 */
async function sendDiscordWithFiles(webhookUrl: string, payload: WebhookPayload): Promise<Response> {
  const formData = new FormData();

  // Build JSON payload (without files)
  const jsonPayload: Record<string, unknown> = {};

  if (payload.content) {
    jsonPayload.content = payload.content;
  }

  if (payload.embeds?.length) {
    jsonPayload.embeds = payload.embeds;
  }

  if (payload.username) {
    jsonPayload.username = payload.username;
  }

  if (payload.avatarUrl) {
    jsonPayload.avatar_url = payload.avatarUrl;
  }

  // Add attachments metadata
  if (payload.files?.length) {
    jsonPayload.attachments = payload.files.map((file, index) => ({
      id: index,
      filename: file.name,
    }));
  }

  formData.append('payload_json', JSON.stringify(jsonPayload));

  // Add files
  if (payload.files) {
    for (const [i, file] of payload.files.entries()) {
      const blob = new Blob([file.data], { type: file.contentType ?? 'application/octet-stream' });
      formData.append(`files[${i}]`, blob, file.name);
    }
  }

  return fetch(webhookUrl, {
    method: 'POST',
    body: formData,
  });
}

// ============================================================================
// Generic Webhook
// ============================================================================

/**
 * Send payload to a generic HTTP webhook
 *
 * If only metadata is provided (with url, label, timestamp), sends that directly.
 * Otherwise sends the full structure with content, files, etc.
 */
async function sendToGeneric(webhookUrl: string, payload: WebhookPayload): Promise<Response> {
  // If only metadata is provided, send it directly as the body
  // This supports the simplified { url, label, timestamp } format
  if (payload.metadata && !payload.content && !payload.files?.length && !payload.embeds?.length) {
    return fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload.metadata),
    });
  }

  // Otherwise, build the full body
  const body: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
  };

  if (payload.content) {
    body.content = payload.content;
  }

  // Convert files to base64 for JSON transport
  if (payload.files?.length) {
    body.files = payload.files.map((file) => ({
      name: file.name,
      contentType: file.contentType ?? 'application/octet-stream',
      data: Buffer.from(file.data).toString('base64'),
      encoding: 'base64',
    }));
  }

  // Include any metadata
  if (payload.metadata) {
    body.metadata = payload.metadata;
  }

  // Include embeds as-is (receiver can interpret them)
  if (payload.embeds?.length) {
    body.embeds = payload.embeds;
  }

  return fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
