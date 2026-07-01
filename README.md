# HF Relay (router.huggingface.co) - Relay template

A small controlled relay service that forwards requests from clients to Hugging Face's router (<https://router.huggingface.co>), injecting the Hugging Face Bearer token on the server side. Useful with restricted networks, rate limiting, and client authentication.

Features

- Server-side HF token injection (HF_TOKEN stored as env/secret)
- Multiple client authentication methods:
  - `x-relay-key` header (custom)
  - `api_key` query parameter
  - `Authorization: Bearer xxx` (standard HTTP)
- CORS headers for browser clients
- Basic rate limiting
- Streaming-friendly proxy (does not buffer responses)

Important security note

- NEVER commit your HF_TOKEN to source control.
- Use environment variables or secret management (Kubernetes Secret, Vault, Cloud Secret Manager).
- Limit CLIENT_API_KEY, set ALLOWED_ORIGINS appropriately, and enable rate limiting to avoid abuse and unexpected HF billing.

Quickstart (Docker Compose)

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

Usage examples

The relay exposes endpoints under `/hf/*` which are forwarded to `https://router.huggingface.co/*`.

**Original Hugging Face request:**

```powershell
curl "https://router.huggingface.co/v1/chat/completions" ^
  -H "Authorization: Bearer $HF_TOKEN" ^
  -H "Content-Type: application/json" ^
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"What is the capital of France?\"}],\"model\":\"zai-org/GLM-5.2:novita\",\"stream\":false}"
```

**Relay request:**

```powershell
curl -X POST "http://localhost:8080/hf/v1/chat/completions" ^
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

**Using Authorization Bearer token (standard HTTP - recommended for most clients):**

```bash
curl -X POST "http://localhost:8080/hf/models/gpt2/outputs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer change-me" \
  -d '{"inputs":"Hello from relay"}'
```

Notes for Hugging Face endpoints

- The relay simply forwards the path and query string after `/hf`.
- For streaming model outputs (SSE/chunked), the relay forwards streams and preserves streaming semantics. Test carefully with your client.

Production recommendations

- Use a secret manager for HF_TOKEN.
- Run behind TLS (put this behind a reverse proxy / load balancer that terminates TLS).
- Use fine-grained ALLOWED_ORIGINS and a stronger client auth method (JWT, OAuth).
- Add logging/monitoring and alerting for unusual traffic (HF calls are billable).
- Consider per-client quotas, per-model restrictions, and stricter rate-limits.

Extending

- Add request/response filtering to remove or redact sensitive prompt content from logs.
- Add per-client usage counters / quotas in a DB.
- Add IP-based blocklist/allowlist if needed.

If you want, I can:

- Create the GitHub repository and push these files (tell me owner/repo).
- Convert this to a Kubernetes manifest (Deployment + Service + Secret + Ingress).
- Replace the simple API key auth with JWT-based auth (example code).
- Add automated tests and GitHub Actions for build/publish.
