# Build stage with build tools
FROM oven/bun:alpine AS builder
WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
# and npm for packages that don't work well with bun install scripts
# Also install yt-dlp and ffmpeg (includes ffprobe) for media handling
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    npm \
    yt-dlp \
    ffmpeg

# Copy package files first (better layer caching)
COPY package.json bun.lock ./

# Install dependencies - use npm ci for packages with native addons
# then bun for the rest (faster)
RUN npm install --ignore-scripts && \
    npm rebuild better-sqlite3 && \
    npm rebuild sharp

# Copy source code
COPY . .

# Production stage - clean Alpine image
FROM oven/bun:alpine AS production
WORKDIR /app

# Install only runtime dependencies for native modules
# and media tools (yt-dlp, ffmpeg which includes ffprobe, python3)
RUN apk add --no-cache \
    vips \
    yt-dlp \
    ffmpeg \
    python3

# Create non-root user for security
RUN addgroup -g 1001 -S sara && \
    adduser -S sara -u 1001

# Copy built application from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/cli.ts ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/app ./app
COPY --from=builder /app/bot ./bot
COPY --from=builder /app/core ./core
COPY --from=builder /app/migrations ./migrations

# Copy entrypoint script
COPY --from=builder /app/.docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create directories with proper permissions
RUN mkdir -p /app/data /app/config && \
    chown -R sara:sara /app

# Switch to non-root user
USER sara

# Environment variables with defaults
ENV TYPE=discord
ENV CONFIGPATH=config/config.ts

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD pgrep -f "bun" > /dev/null || exit 1

ENTRYPOINT ["/entrypoint.sh"]
