# Build stage with build tools
FROM oven/bun:debian AS builder
WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
# and npm for packages that don't work well with bun install scripts
# Also install yt-dlp and ffmpeg (includes ffprobe) for media handling
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    npm \
    yt-dlp \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first (better layer caching)
COPY package.json bun.lock ./

# Install dependencies - use npm ci for packages with native addons
# then bun for the rest (faster)
RUN npm install --ignore-scripts && \
    npm rebuild better-sqlite3 && \
    npm rebuild sharp

# Copy source code
COPY . .

# Production stage - clean Debian image
FROM oven/bun:debian AS production
WORKDIR /app

# Install only runtime dependencies for native modules
# and media tools (yt-dlp, ffmpeg which includes ffprobe, python3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 \
    yt-dlp \
    ffmpeg \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -g 1001 sara && \
    useradd -u 1001 -g sara -s /bin/sh sara

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
