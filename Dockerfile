# Use Node 24 for runtime
FROM node:24-alpine

# Create app dir
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy files
COPY . .

# Default port (can be overridden by PORT env variable)
ARG PORT=8080
ENV PORT=${PORT}

EXPOSE ${PORT}

ENV NODE_ENV=production

CMD ["node", "server.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --spider http://localhost:${PORT}/health || exit 1
