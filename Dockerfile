# CallMe MCP Server - Docker image for cloud deployment
FROM oven/bun:1 AS base

WORKDIR /app

# Install dependencies
COPY server/package.json server/bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY server/src ./src

# Default port (Coolify sets PORT env var)
ENV PORT=3333

# Expose single port for all traffic
EXPOSE 3333

# Health check using bun (curl not available in bun image)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3333/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Run SSE mode for cloud deployment
CMD ["bun", "run", "src/index-sse.ts"]
