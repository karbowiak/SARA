/**
 * Immich Client - Handles uploads, albums, and asset management
 *
 * Provides a singleton service for interacting with Immich API.
 * Handles authentication, album management, and asset uploads with metadata.
 */

import * as fs from 'node:fs';
import { basename } from 'node:path';
import {
  addAssetsToAlbum,
  createAlbum,
  getAlbumInfo,
  getAllAlbums,
  init,
  updateAlbumInfo,
  updateAsset,
  uploadAsset,
} from '@immich/sdk';
import { getBotConfig, type ImmichConfig } from '../config';

export interface UploadResult {
  id: string;
  status: 'created' | 'duplicate';
}

export class ImmichClient {
  private albumCache: Map<string, string> = new Map();
  private initialized = false;
  private config: ImmichConfig | null = null;
  private logger?: {
    warn: (msg: string) => void;
    info: (msg: string) => void;
    debug: (msg: string) => void;
    error: (msg: string, meta?: any) => void;
  };

  constructor(logger?: {
    warn: (msg: string) => void;
    info: (msg: string) => void;
    debug: (msg: string) => void;
    error: (msg: string, meta?: any) => void;
  }) {
    this.logger = logger;
    this.initialize();
  }

  private initialize() {
    if (this.initialized) return;

    const config = getBotConfig();
    if (!config?.immich?.enabled) {
      if (this.logger) {
        this.logger.warn('[Immich] Immich not enabled in config');
      }
      this.initialized = true;
      return;
    }

    this.config = config.immich;

    let url = this.config.url;
    if (!url.endsWith('/api') && !url.endsWith('/api/')) {
      url = `${url}/api`;
    }

    init({
      baseUrl: url,
      apiKey: this.config.apiKey,
    });

    this.initialized = true;
    if (this.logger) {
      this.logger.info('[Immich] Initialized');
    }
  }

  isReady(): boolean {
    return this.initialized && this.config !== null;
  }

  private sanitizeFilename(filename: string): string {
    // Remove query parameters
    let sanitized = filename.split('?')[0] || filename;

    // URL-decode the filename (handles %3A -> :, %20 -> space, etc.)
    try {
      sanitized = decodeURIComponent(sanitized);
    } catch {
      // If decoding fails, continue with original
    }

    // Split by colon to separate Discord CDN / Twitter suffixes like :large, :small
    const colonParts = sanitized.split(':');
    const baseName = colonParts[0] || sanitized;

    // If no colon suffixes, return as-is
    if (colonParts.length === 1) {
      return baseName;
    }

    // Return base name (already includes extension)
    return baseName;
  }

  private getMimeType(filename: string): string {
    // Sanitize filename before extracting extension
    const sanitized = this.sanitizeFilename(filename);
    const ext = sanitized.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      ico: 'image/x-icon',
      svg: 'image/svg+xml',
      tiff: 'image/tiff',
      psd: 'image/vnd.adobe.photoshop',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  async uploadAsset(
    filePath: string,
    createdAt: Date,
    description?: string,
    visibility?: 'archive' | 'timeline',
  ): Promise<UploadResult | null> {
    if (!this.isReady()) {
      if (this.logger) {
        this.logger.error('[Immich] Not ready, cannot upload');
      }
      return null;
    }

    try {
      const fileContent = fs.readFileSync(filePath);
      const originalFilename = basename(filePath);
      const filename = this.sanitizeFilename(originalFilename);

      const stats = fs.statSync(filePath);

      const deviceAssetId = `${filename}-${stats.size}`;
      const deviceId = 'discord-image-fetcher';

      // Create File without explicit MIME type to match redditfetcher's working implementation
      const file = new File([fileContent], filename);

      // Debug logging for filename transformation
      if (this.logger) {
        this.logger.debug(
          `[Immich] Uploading: ${originalFilename} -> ${filename} [${(stats.size / 1024).toFixed(2)} KB]`,
        );
      }

      const response = await uploadAsset({
        assetMediaCreateDto: {
          assetData: file,
          deviceAssetId,
          deviceId,
          fileCreatedAt: createdAt.toISOString(),
          fileModifiedAt: stats.mtime.toISOString(),
          isFavorite: false,
          metadata: [],
          filename: filename,
        },
      });

      if (response.status === 'created') {
        if (description || visibility) {
          await this.updateAssetProperties(response.id, description, visibility);
        }
      }

      return {
        id: response.id,
        status: response.status as 'created' | 'duplicate',
      };
    } catch (error) {
      if (this.logger) {
        this.logger.error(`[Immich] Failed to upload asset ${basename(filePath)}:`, { error });
      }
      return null;
    }
  }

  async updateAssetProperties(
    assetId: string,
    description?: string,
    visibility?: 'archive' | 'timeline',
  ): Promise<boolean> {
    if (!this.isReady()) return false;

    try {
      const updateData: Record<string, unknown> = {};
      if (description) updateData.description = description;
      if (visibility) updateData.visibility = visibility;

      await updateAsset({
        id: assetId,
        updateAssetDto: updateData,
      });

      return true;
    } catch (error) {
      if (this.logger) {
        this.logger.error(`[Immich] Failed to update asset ${assetId}:`, { error });
      }
      return false;
    }
  }

  async ensureAlbum(albumName: string, description?: string): Promise<string | null> {
    if (!this.isReady()) return null;

    if (this.albumCache.has(albumName)) {
      return this.albumCache.get(albumName) || null;
    }

    try {
      const [unsharedAlbums, sharedAlbums] = await Promise.all([
        getAllAlbums({ shared: false }),
        getAllAlbums({ shared: true }),
      ]);

      const allAlbums = [...unsharedAlbums, ...sharedAlbums];
      const existing = allAlbums.find((a) => a.albumName === albumName);

      if (existing) {
        this.albumCache.set(albumName, existing.id);
        if (description && existing.description !== description) {
          await this.updateAlbumDescription(existing.id, description);
        }
        return existing.id;
      }

      const newAlbum = await createAlbum({
        createAlbumDto: {
          albumName,
          description,
        },
      });

      this.albumCache.set(albumName, newAlbum.id);
      return newAlbum.id;
    } catch (error) {
      if (this.logger) {
        this.logger.error(`[Immich] Failed to ensure album ${albumName}:`, { error });
      }
      return null;
    }
  }

  async updateAlbumDescription(albumId: string, description: string): Promise<boolean> {
    if (!this.isReady()) return false;

    try {
      await updateAlbumInfo({
        id: albumId,
        updateAlbumDto: {
          description,
        },
      });
      if (this.logger) {
        this.logger.info(`[Immich] Updated description for album ${albumId}`);
      }
      return true;
    } catch (error) {
      if (this.logger) {
        this.logger.error(`[Immich] Failed to update album description for ${albumId}:`, { error });
      }
      return false;
    }
  }

  async addAssetToAlbum(albumId: string, assetId: string): Promise<void> {
    if (!this.isReady()) return;

    try {
      await addAssetsToAlbum({
        id: albumId,
        bulkIdsDto: {
          ids: [assetId],
        },
      });
    } catch (error) {
      if (this.logger) {
        this.logger.error(`[Immich] Failed to add asset ${assetId} to album ${albumId}:`, { error });
      }
    }
  }
}

export const immichClient = new ImmichClient();
