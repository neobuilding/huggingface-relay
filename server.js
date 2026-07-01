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

// NOTE: Do NOT use express.json() before proxy middleware
// http-proxy-middleware v4.x has issues with pre-parsed bodies
// Instead, we let the proxy handle the raw request stream directly

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
  let authMethod = 'none';
  
  // Support standard Authorization: Bearer xxx
  if (!key) {
    const authHeader = req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      key = authHeader.slice(7); // Remove "Bearer " prefix
      authMethod = 'Authorization:Bearer';
    }
  } else if (req.header('x-relay-key')) {
    authMethod = 'x-relay-key';
  } else if (req.query.api_key) {
    authMethod = 'api_key';
  }
  
  if (!key || key !== CLIENT_API_KEY) {
    const logMessage = !key
      ? `[AUTH_FAILED] No auth provided | Method: ${authMethod} | Path: ${req.method} ${req.path} | IP: ${req.ip}`
      : `[AUTH_FAILED] Invalid key | Method: ${authMethod} | Provided: ${key.slice(0, 10)}... | Path: ${req.method} ${req.path} | IP: ${req.ip}`;
    console.warn(logMessage);
    return res.status(401).json({ error: 'Unauthorized - invalid relay key' });
  }
  
  console.log(`[AUTH_OK] Auth method: ${authMethod} | Path: ${req.method} ${req.path} | IP: ${req.ip}`);
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
  handler: (req, res) => {
    console.warn(`[RATE_LIMIT_EXCEEDED] IP: ${req.ip} | Path: ${req.method} ${req.path}`);
    res.status(429).json({ error: 'Too many requests, please try again later.' });
  },
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
    // Remove client-provided Authorization to avoid conflicts
    proxyReq.removeHeader('Authorization');
    
    // Inject HF authorization header (server-side secret)
    proxyReq.setHeader('Authorization', `Bearer ${HF_TOKEN}`);
    
    // Remove cookies from client
    proxyReq.removeHeader('cookie');
    
    console.log(`[PROXY_REQ] Path: ${req.method} ${req.path} | Target: ${proxyReq.path} | Auth: HF_TOKEN injected (len: ${HF_TOKEN.length}) | IP: ${req.ip}`);
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`[PROXY_RES] Path: ${req.method} ${req.path} | Status: ${proxyRes.statusCode}`);
  },
  // Error handler
  onError: (err, req, res) => {
    console.error(`[PROXY_ERROR] Path: ${req.method} ${req.path} | Error: ${err && err.message} | IP: ${req.ip}`);
    if (res.headersSent) {
      try { res.end(); } catch (e) { /* ignore */ }
      return;
    }

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
  console.log(`[START] HF Relay listening on port ${PORT}`);
  console.log(`[CONFIG] CLIENT_API_KEY configured: ${CLIENT_API_KEY !== 'change-me' ? 'yes' : 'WARNING: using default (change-me)'}`);
  console.log(`[CONFIG] HF_TOKEN configured: ${HF_TOKEN ? 'yes' : 'ERROR: missing'}`);
  console.log(`[CONFIG] HF_TOKEN length: ${HF_TOKEN ? HF_TOKEN.length : 0}`);
  console.log(`[CONFIG] ALLOWED_ORIGINS: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`[CONFIG] RATE_LIMIT: ${RATE_LIMIT} req/min`);
});
