# Use Node 24 for runtime
FROM node:24-alpine

# Create app dir
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy files
COPY . .

# Expose port
EXPOSE 8080

ENV NODE_ENV=production

CMD ["node", "server.js"]
