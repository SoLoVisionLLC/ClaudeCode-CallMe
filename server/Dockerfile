# CallMe MCP Server - Docker image for cloud deployment
FROM oven/bun:1 AS base

WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src ./src

# Environment variables (to be overridden at runtime)
ENV PORT=3333
ENV CALLME_PORT=3333

# Expose ports:
# - 3333: Webhooks and media streams (for phone providers)
# - 3334: MCP SSE transport (for Claude Code)
EXPOSE 3333 3334

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3333/health || exit 1

# Run SSE mode for cloud deployment
CMD ["bun", "run", "src/index-sse.ts"]
