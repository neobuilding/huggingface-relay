/**
 * HF Relay - server.js
 * 简单受控的 Hugging Face router relay（支持流式转发）
 *
 * 依赖: express http-proxy-middleware express-rate-limit helmet dotenv morgan
 */
require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();

const PORT = parseInt(process.env.PORT || '8080', 10);
const HF_TOKEN = process.env.HF_TOKEN; // 必须设置
const CLIENT_API_KEY = process.env.CLIENT_API_KEY || 'change-me';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || '60', 10); // requests per minute

if (!HF_TOKEN) {
  console.error('ERROR: HF_TOKEN is not set. Set it in environment or .env file.');
  process.exit(1);
}

// Basic middlewares
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Healthcheck
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Simple client auth - support multiple auth methods:
// 1. x-relay-key header
// 2. api_key query parameter
// 3. Authorization: Bearer token
app.use((req, res, next) => {
  // allow health probe unauthenticated
  if (req.path === '/health') return next();

  let key = req.header('x-relay-key') || req.query.api_key;
  
  // Support standard Authorization: Bearer xxx
  if (!key) {
    const authHeader = req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      key = authHeader.slice(7); // Remove "Bearer " prefix
    }
  }
  
  if (!key || key !== CLIENT_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized - invalid relay key' });
  }
  next();
});

// CORS handling for browser clients
app.use((req, res, next) => {
  const origin = req.get('Origin') || '*';
  if (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin === 'null' ? '*' : origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-relay-key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Basic rate limiting (per IP)
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Proxy configuration: all requests under /hf/* -> https://router.huggingface.co/*
const hfProxy = createProxyMiddleware({
  target: 'https://router.huggingface.co',
  changeOrigin: true,
  secure: true,
  ws: false,
  // preserve path after /hf
  pathRewrite: (path, req) => {
    // path example: /hf/models/xxx/outputs -> /models/xxx/outputs
    return path.replace(/^\/hf/, '');
  },
  onProxyReq: (proxyReq, req, res) => {
    // Inject HF authorization header (server-side secret)
    proxyReq.setHeader('Authorization', `Bearer ${HF_TOKEN}`);
    // Remove cookies from client
    proxyReq.removeHeader('cookie');

    // If body is already parsed by express (we didn't add body-parser), nothing to do.
    // We intentionally don't parse body to avoid buffering; http-proxy-middleware will pipe the request stream.
  },
  // Simplified onError: only handle genuine proxy/network errors and avoid writing when headers already sent.
  onError: (err, req, res) => {
    console.error('Proxy network error:', err && err.message);
    // If headers already sent, we must not attempt to write a response. Just end the connection.
    if (res.headersSent) {
      try { res.end(); } catch (e) { /* ignore */ }
      return;
    }

    // Minimal 502 response for network/proxy errors. Keep it simple so we don't overwrite upstream HTTP errors.
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Bad Gateway');
  },
  proxyTimeout: 120000,
  timeout: 120000,
  // Keep response streaming (don't buffer)
  selfHandleResponse: false,
});

app.use('/hf', hfProxy);

// Root instructions
app.get('/', (req, res) => {
  res.type('text/plain').send('HF Relay is running. See README for usage.');
});

// Start
app.listen(PORT, () => {
  console.log(`HF Relay listening on port ${PORT}`);
});
