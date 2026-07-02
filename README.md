# HF Relay (router.huggingface.co) - Relay template

A small controlled relay service that forwards requests from clients to Hugging Face's router (<https://router.huggingface.co>), injecting the Hugging Face Bearer token on the server side. Useful when you want to share a single HF token with trusted clients without exposing the token itself.

Built with **Express 5** + **express-http-proxy**, supports HTTP and HTTPS, streaming, and multiple client auth methods.

## Features

- Server-side HF token injection (`HF_TOKEN` stored as env/secret, never exposed to clients)
- Multiple client authentication methods:
  - `x-relay-key` header (custom)
  - `api_key` query parameter
  - `Authorization: Bearer xxx` (standard HTTP)
- CORS headers for browser clients (configurable `ALLOWED_ORIGINS`)
- Basic rate limiting (configurable, per IP)
- Streaming-friendly proxy (does not buffer responses)
- Built-in HTTPS support (configure SSL certificates via env)
- Cookie stripping (client cookies are removed before forwarding to HF)
- Request body size limit: 50 MB (JSON / URL-encoded)
- Docker health check built into the image
- GitHub Actions workflow for automated dependency upgrades

## Important security note

- **NEVER** commit your `HF_TOKEN` to source control.
- Use environment variables or secret management (Kubernetes Secret, Vault, Cloud Secret Manager).
- Set a strong `CLIENT_API_KEY`, configure `ALLOWED_ORIGINS` appropriately, and enable rate limiting to avoid abuse and unexpected HF billing.
- The relay strips client cookies before forwarding requests to Hugging Face.

## Quickstart (Docker Compose)

1. Create a new repository and add the files in this template.
2. Copy `.env.example` to `.env` and edit:
   - `HF_TOKEN` = your Hugging Face Bearer token (from HF settings)
   - `CLIENT_API_KEY` = a secret key for clients (you will give this to trusted clients)
   - `ALLOWED_ORIGINS` = comma-separated origins you allow (or `*` for testing)
3. Start with Docker Compose:

   ```bash
   docker compose up -d --build
   ```

4. Check health:

   ```bash
   curl http://localhost:8080/health
   ```

5. Stop with Docker Compose:

   ```bash
   docker compose down --remove-orphans
   ```

## Quick update

Use the included `update.sh` script to pull the latest code and rebuild:

```bash
bash update.sh
```

This script will:

1. Stop and remove running containers (`docker compose down --remove-orphans`)
2. Pull the latest code from git (`git pull`)
3. Rebuild and start the service (`docker compose up --build`)

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `HTTPS_PORT` | `8443` | HTTPS listen port (only active when SSL is configured) |
| `HF_TOKEN` | *(required)* | Hugging Face Bearer token — **must be set**, server exits without it |
| `CLIENT_API_KEY` | `change-me` | Secret key for client authentication (change this!) |
| `ALLOWED_ORIGINS` | `*` | Comma-separated list of allowed CORS origins |
| `RATE_LIMIT` | `60` | Max requests per IP per minute |
| `SSL_CERT` | *(empty)* | Path to SSL fullchain certificate file (e.g. `/app/certs/fullchain.pem`) |
| `SSL_KEY` | *(empty)* | Path to SSL private key file (e.g. `/app/certs/key.pem`) |
| `CERT_DIR` | `./.certs` | Host directory containing SSL certificates, mounted into container at `/app/certs:ro` |
| `NODE_ENV` | `production` | Node.js environment (`production` → combined morgan logs, `development` → dev logs) |

### HTTPS / SSL configuration

To enable HTTPS, set `SSL_CERT` and `SSL_KEY` in your `.env` to point to the certificate files **inside the container**. The Docker Compose mounts your host `CERT_DIR` to `/app/certs` (read-only).

Example `.env`:

```env
CERT_DIR=/root/acme/caddy_v2ray-cert
SSL_CERT=/app/certs/fullchain.pem
SSL_KEY=/app/certs/key.pem
HTTPS_PORT=8443
```

When SSL is properly configured, the server will listen on both HTTP (`PORT`) and HTTPS (`HTTPS_PORT`). If the certificate files cannot be loaded, an error is logged but the HTTP server continues running.

## Generating CLIENT_API_KEY

`CLIENT_API_KEY` should be a strong, random secret string. Here are several methods to generate it:

**Option 1: Using OpenSSL (Linux/macOS)**

```bash
openssl rand -hex 32
```

This generates a 64-character hexadecimal string, e.g., `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2`

**Option 2: Using Python**

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

**Option 3: Using Node.js**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Option 4: Using /dev/urandom (Linux/macOS)**

```bash
head -c 32 /dev/urandom | base64
```

**Option 5: Using PowerShell (Windows)**

```powershell
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

**Recommendation:** Use at least 32 bytes of entropy. For production, use Option 1 (OpenSSL) or Option 2 (Python) as they are simple, portable, and well-tested.

Once generated, add it to your `.env` file:

```bash
CLIENT_API_KEY=your_generated_secret_key_here
```

## Usage examples

The relay exposes endpoints under `/hf/*` which are forwarded to `https://router.huggingface.co/*`.

**Original Hugging Face request:**

```powershell
curl -i -X POST "https://router.huggingface.co/v1/chat/completions" ^
  -H "Authorization: Bearer $HF_TOKEN" ^
  -H "Content-Type: application/json" ^
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"What is the capital of France?\"}],\"model\":\"zai-org/GLM-5.2:novita\",\"stream\":false}"
```

**Relay request:**

```powershell
curl -i -X POST "http://localhost:8080/hf/v1/chat/completions" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer change-me" ^
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"What is the capital of France?\"}],\"model\":\"zai-org/GLM-5.2:novita\",\"stream\":false}"
```

**Using x-relay-key header (custom):**

```bash
curl -X POST "http://localhost:8080/hf/models/gpt2/outputs" \
  -H "Content-Type: application/json" \
  -H "x-relay-key: change-me" \
  -d '{"inputs":"Hello from relay"}'
```

**Using api_key query parameter:**

```bash
curl -X POST "http://localhost:8080/hf/models/gpt2/outputs?api_key=change-me" \
  -H "Content-Type: application/json" \
  -d '{"inputs":"Hello from relay"}'
```

**Using Authorization Bearer token (standard HTTP — recommended for most clients):**

```bash
curl -X POST "http://localhost:8080/hf/models/gpt2/outputs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer change-me" \
  -d '{"inputs":"Hello from relay"}'
```

## Notes for Hugging Face endpoints

- The relay forwards the path and query string after `/hf`. For example, `/hf/v1/chat/completions` → `https://router.huggingface.co/v1/chat/completions`.
- For streaming model outputs (SSE/chunked), the relay forwards streams and preserves streaming semantics. Test carefully with your client.
- The `/health` endpoint is accessible without authentication for monitoring probes.

## Docker details

The Docker image is based on **Node 24 Alpine** and includes a built-in health check:

- **Health check**: `wget --spider http://localhost:8080/health` every 30 seconds
- **Ports exposed**: `8080` (HTTP) and `8443` (HTTPS)
- **Production install**: `npm ci --omit=dev` (dev dependencies not installed)
- **Node.js requirement**: >= 22.0.0

## GitHub Actions: automated dependency upgrades

The repository includes a GitHub Actions workflow ([`.github/workflows/upgrade-deps.yml`](.github/workflows/upgrade-deps.yml)) that automatically upgrades npm dependencies:

- **Trigger**: Manual (`workflow_dispatch`)
- **Process**:
  1. Runs `ncu -u` (npm-check-updates) to upgrade `package.json` to latest versions
  2. Runs `npm install --omit=dev` to update `package-lock.json`
  3. Commits and pushes changes with message `chore(deps): upgrade dependencies to latest`
- **Guard**: Skips if the head commit was already made by this workflow (prevents loops)

## Python alternative (relay.py)

A lightweight Python/FastAPI alternative is included as `relay.py`:

```bash
export HF_TOKEN="hf_your_real_token"
export SK_RELAY="sk-relay-your_random_secret"
python3 -m uvicorn relay:app --host 0.0.0.0 --port 8400
```

Key differences from the Node.js version:

- Uses **FastAPI** + **httpx** instead of Express
- Auth via `SK_RELAY` environment variable (only `Authorization: Bearer` method)
- Auto-prefixes `v1/` to paths that don't already start with `v1/`
- No `/hf` prefix — all paths are forwarded directly
- No built-in rate limiting or CORS configuration

## Production recommendations

- Use a secret manager for `HF_TOKEN`.
- Run behind TLS (use the built-in HTTPS support or put this behind a reverse proxy / load balancer that terminates TLS).
- Use fine-grained `ALLOWED_ORIGINS` and a stronger client auth method (JWT, OAuth).
- Add logging/monitoring and alerting for unusual traffic (HF calls are billable).
- Consider per-client quotas, per-model restrictions, and stricter rate-limits.

## Extending

- Add request/response filtering to remove or redact sensitive prompt content from logs.
- Add per-client usage counters / quotas in a DB.
- Add IP-based blocklist/allowlist if needed.
