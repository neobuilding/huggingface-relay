# Use Node 24 for runtime
FROM node:24-alpine

# Create app dir
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy files
COPY . .

# Create certs directory for SSL certificates
RUN mkdir -p /app/certs

# Expose HTTP and HTTPS ports
EXPOSE 8080 8443

ENV NODE_ENV=production

CMD ["node", "server.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --spider http://localhost:8080/health || exit 1
