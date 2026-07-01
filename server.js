/**
 * HF Relay - server.js
 * 简单受控的 Hugging Face router relay（支持流式转发）
 *
 * 依赖: express express-http-proxy express-rate-limit helmet dotenv morgan
 */
require('dotenv').config();
const express = require('express');
const proxy = require('express-http-proxy');
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

// Parse JSON and URL-encoded request bodies
// express-http-proxy will handle re-forwarding them correctly
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Healthcheck (BEFORE auth/proxy so it's accessible)
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
// Using express-http-proxy for better body handling
app.use('/hf', proxy('https://router.huggingface.co', {
  proxyReqPathResolver: (req) => {
    // path example: /hf/models/xxx/outputs -> /models/xxx/outputs
    return req.url.replace(/^\/hf/, '');
  },
  proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
    // Inject HF authorization header (server-side secret)
    proxyReqOpts.headers = proxyReqOpts.headers || {};
    proxyReqOpts.headers['Authorization'] = `Bearer ${HF_TOKEN}`;
    
    // Remove client cookies
    delete proxyReqOpts.headers['cookie'];
    
    console.log(`[PROXY_REQ] Path: ${srcReq.method} ${srcReq.path} | Target: ${proxyReqOpts.path || srcReq.url.replace(/^\/hf/, '')} | Auth: HF_TOKEN injected (len: ${HF_TOKEN.length}) | IP: ${srcReq.ip}`);
    
    return proxyReqOpts;
  },
  userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
    // Log response status
    console.log(`[PROXY_RES] Path: ${userReq.method} ${userReq.path} | Status: ${proxyRes.statusCode}`);
    return proxyResData;
  },
  onError: (err, req, res) => {
    console.error(`[PROXY_ERROR] Path: ${req.method} ${req.path} | Error: ${err && err.message} | IP: ${req.ip}`);
    res.status(502).json({ error: 'Bad Gateway', details: err.message });
  }
}));

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
