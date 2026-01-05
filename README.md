# Antigravity Claude Proxy

[![npm version](https://img.shields.io/npm/v/antigravity-claude-proxy.svg)](https://www.npmjs.com/package/antigravity-claude-proxy)
[![npm downloads](https://img.shields.io/npm/dm/antigravity-claude-proxy.svg)](https://www.npmjs.com/package/antigravity-claude-proxy)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<a href="https://buymeacoffee.com/badrinarayanans" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="50"></a>

A proxy server that exposes an **Anthropic-compatible API** backed by **Antigravity's Cloud Code**, letting you use Claude and Gemini models with **Claude Code CLI**, **LiteLLM**, or any Anthropic-compatible client.

![Antigravity Claude Proxy Banner](images/banner.png)

## How It Works

```
┌──────────────────┐     ┌─────────────────────┐     ┌────────────────────────────┐
│   Claude Code    │────▶│  This Proxy Server  │────▶│  Antigravity Cloud Code    │
│   (Anthropic     │     │  (Anthropic → Google│     │  (daily-cloudcode-pa.      │
│    API format)   │     │   Generative AI)    │     │   sandbox.googleapis.com)  │
└──────────────────┘     └─────────────────────┘     └────────────────────────────┘
```

1. Receives requests in **Anthropic Messages API format**
2. Uses OAuth tokens from added Google accounts (or Antigravity's local database)
3. Transforms to **Google Generative AI format** with Cloud Code wrapping
4. Sends to Antigravity's Cloud Code API
5. Converts responses back to **Anthropic format** with full thinking/streaming support

## Prerequisites

- **Node.js** 18 or later (for npm installation)
- **Docker** (for containerized deployment)
- **Antigravity** installed (for single-account mode) OR Google account(s) for multi-account mode

---

## Installation

### Option 1: Docker (Recommended for Servers)

Pre-built images are available for `linux/amd64` and `linux/arm64`:

```bash
docker pull ghcr.io/johnneerdael/antigravity-claude-proxy:latest
```

Create a `docker-compose.yml`:

```yaml
version: '3.8'

services:
  antigravity-proxy:
    image: ghcr.io/johnneerdael/antigravity-claude-proxy:latest
    container_name: antigravity-proxy
    ports:
      - "8080:8080"
    volumes:
      - ./data:/root/.config/antigravity-proxy
    environment:
      - PORT=8080
      - DEBUG=false
      - FALLBACK=true
    restart: unless-stopped
```

Add accounts and start:

```bash
# Add Google account (headless mode for servers)
docker run -it --rm \
  -v $(pwd)/data:/root/.config/antigravity-proxy \
  ghcr.io/johnneerdael/antigravity-claude-proxy:latest \
  node bin/cli.js accounts add --no-browser

# Start the proxy
docker-compose up -d

# Verify
curl http://localhost:8080/health
```

> **Multi-account setup?** See [docs/DOCKER-MULTI-ACCOUNT.md](docs/DOCKER-MULTI-ACCOUNT.md) for production deployment with load balancing, reverse proxy examples, and monitoring.

### Option 2: npm

```bash
# Run directly with npx (no install needed)
npx antigravity-claude-proxy start

# Or install globally
npm install -g antigravity-claude-proxy
antigravity-claude-proxy start
```

### Option 3: Clone Repository

```bash
git clone https://github.com/johnneerdael/antigravity-claude-proxy.git
cd antigravity-claude-proxy
npm install
npm start
```

---

## Quick Start

### 1. Add Account(s)

You have two options:

**Option A: Use Antigravity (Single Account)**

If you have Antigravity installed and logged in, the proxy will automatically extract your token. No additional setup needed.

**Option B: Add Google Accounts via OAuth (Recommended for Multi-Account)**

Add one or more Google accounts for load balancing.

#### Desktop/Laptop (with browser)

```bash
# If installed via npm
antigravity-claude-proxy accounts add

# If using npx
npx antigravity-claude-proxy accounts add

# If cloned locally
npm run accounts:add
```

This opens your browser for Google OAuth. Sign in and authorize access. Repeat for multiple accounts.

#### Headless Server (Docker, SSH, no desktop)

```bash
# If installed via npm
antigravity-claude-proxy accounts add --no-browser

# If using npx
npx antigravity-claude-proxy accounts add -- --no-browser

# If cloned locally
npm run accounts:add -- --no-browser
```

This displays an OAuth URL you can open on another device (phone/laptop). After signing in, copy the redirect URL or authorization code and paste it back into the terminal.

#### Manage accounts

```bash
# List all accounts
antigravity-claude-proxy accounts list

# Verify accounts are working
antigravity-claude-proxy accounts verify

# Interactive account management
antigravity-claude-proxy accounts
```

### 2. Start the Proxy Server

```bash
# If installed via npm
antigravity-claude-proxy start

# If using npx
npx antigravity-claude-proxy start

# If cloned locally
npm start

# If using Docker
docker-compose up -d
```

The server runs on `http://localhost:8080` by default.

### 3. Verify It's Working

```bash
# Health check
curl http://localhost:8080/health

# Check account status and quota limits
curl "http://localhost:8080/account-limits?format=table"
```

---

## Using with Claude Code CLI

### Configure Claude Code

Create or edit the Claude Code settings file:

**macOS:** `~/.claude/settings.json`
**Linux:** `~/.claude/settings.json`
**Windows:** `%USERPROFILE%\.claude\settings.json`

Add this configuration:

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "test",
    "ANTHROPIC_BASE_URL": "http://localhost:8080",
    "ANTHROPIC_MODEL": "claude-opus-4-5-thinking",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-5-thinking",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-5-thinking",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-sonnet-4-5",
    "CLAUDE_CODE_SUBAGENT_MODEL": "claude-sonnet-4-5-thinking"
  }
}
```

Or to use Gemini models:

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "test",
    "ANTHROPIC_BASE_URL": "http://localhost:8080",
    "ANTHROPIC_MODEL": "gemini-3-pro-high",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "gemini-3-pro-high",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "gemini-3-flash",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gemini-2.5-flash-lite",
    "CLAUDE_CODE_SUBAGENT_MODEL": "gemini-3-flash"
  }
}
```

### Load Environment Variables

Add the proxy settings to your shell profile:

**macOS / Linux:**

```bash
echo 'export ANTHROPIC_BASE_URL="http://localhost:8080"' >> ~/.zshrc
echo 'export ANTHROPIC_API_KEY="test"' >> ~/.zshrc
source ~/.zshrc
```

> For Bash users, replace `~/.zshrc` with `~/.bashrc`

**Windows (PowerShell):**

```powershell
Add-Content $PROFILE "`n`$env:ANTHROPIC_BASE_URL = 'http://localhost:8080'"
Add-Content $PROFILE "`$env:ANTHROPIC_API_KEY = 'test'"
. $PROFILE
```

**Windows (Command Prompt):**

```cmd
setx ANTHROPIC_BASE_URL "http://localhost:8080"
setx ANTHROPIC_API_KEY "test"
```

Restart your terminal for changes to take effect.

### Run Claude Code

```bash
# Make sure the proxy is running first
antigravity-claude-proxy start

# In another terminal, run Claude Code
claude
```

> **Note:** If Claude Code asks you to select a login method, add `"hasCompletedOnboarding": true` to `~/.claude.json` (macOS/Linux) or `%USERPROFILE%\.claude.json` (Windows), then restart your terminal and try again.

---

## Using with LiteLLM

You can use this proxy as a backend for [LiteLLM](https://github.com/BerriAI/litellm) to access Antigravity's free Claude and Gemini models from any OpenAI-compatible client.

### LiteLLM Configuration

Create a `litellm-config.yaml`:

```yaml
model_list:
  # Claude models via Antigravity
  - model_name: claude-sonnet-4-5-thinking
    litellm_params:
      model: openai/claude-sonnet-4-5-thinking
      api_base: http://localhost:8080/v1
      api_key: "not-needed"

  - model_name: claude-opus-4-5-thinking
    litellm_params:
      model: openai/claude-opus-4-5-thinking
      api_base: http://localhost:8080/v1
      api_key: "not-needed"

  - model_name: claude-sonnet-4-5
    litellm_params:
      model: openai/claude-sonnet-4-5
      api_base: http://localhost:8080/v1
      api_key: "not-needed"

  # Gemini models via Antigravity
  - model_name: gemini-3-flash
    litellm_params:
      model: openai/gemini-3-flash
      api_base: http://localhost:8080/v1
      api_key: "not-needed"

  - model_name: gemini-3-pro-high
    litellm_params:
      model: openai/gemini-3-pro-high
      api_base: http://localhost:8080/v1
      api_key: "not-needed"

  - model_name: gemini-3-pro-low
    litellm_params:
      model: openai/gemini-3-pro-low
      api_base: http://localhost:8080/v1
      api_key: "not-needed"
```

### Docker Compose with LiteLLM

Run both the proxy and LiteLLM together:

```yaml
version: '3.8'

services:
  antigravity-proxy:
    image: ghcr.io/johnneerdael/antigravity-claude-proxy:latest
    container_name: antigravity-proxy
    volumes:
      - ./data:/root/.config/antigravity-proxy
    environment:
      - PORT=8080
    restart: unless-stopped

  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    container_name: litellm
    ports:
      - "4000:4000"
    volumes:
      - ./litellm-config.yaml:/app/config.yaml
    command: ["--config", "/app/config.yaml", "--port", "4000"]
    depends_on:
      - antigravity-proxy
    environment:
      - LITELLM_MASTER_KEY=sk-your-master-key
    restart: unless-stopped
```

> **Note:** When running in Docker, use `http://antigravity-proxy:8080/v1` as the `api_base` in your LiteLLM config (container name, not localhost).

### Start the Stack

```bash
# Make sure you have accounts configured in ./data/accounts.json first
docker-compose up -d

# Test via LiteLLM
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-master-key" \
  -d '{
    "model": "claude-sonnet-4-5-thinking",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Use with OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:4000/v1",
    api_key="sk-your-master-key"
)

response = client.chat.completions.create(
    model="claude-sonnet-4-5-thinking",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

---

## Available Models

### Claude Models

| Model ID | Description |
|----------|-------------|
| `claude-sonnet-4-5-thinking` | Claude Sonnet 4.5 with extended thinking |
| `claude-opus-4-5-thinking` | Claude Opus 4.5 with extended thinking |
| `claude-sonnet-4-5` | Claude Sonnet 4.5 without thinking |

### Gemini Models

| Model ID | Description |
|----------|-------------|
| `gemini-3-flash` | Gemini 3 Flash with thinking |
| `gemini-3-pro-low` | Gemini 3 Pro Low with thinking |
| `gemini-3-pro-high` | Gemini 3 Pro High with thinking |

Gemini models include full thinking support with `thoughtSignature` handling for multi-turn conversations.

---

## Multi-Account Load Balancing

When you add multiple accounts, the proxy automatically:

- **Sticky account selection**: Stays on the same account to maximize prompt cache hits
- **Smart rate limit handling**: Waits for short rate limits (≤2 min), switches accounts for longer ones
- **Automatic cooldown**: Rate-limited accounts become available after reset time expires
- **Invalid account detection**: Accounts needing re-authentication are marked and skipped
- **Prompt caching support**: Stable session IDs enable cache hits across conversation turns

Check account status anytime:

```bash
curl "http://localhost:8080/account-limits?format=table"
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/account-limits` | GET | Account status and quota limits (add `?format=table` for ASCII table) |
| `/v1/messages` | POST | Anthropic Messages API |
| `/v1/models` | GET | List available models |
| `/refresh-token` | POST | Force token refresh |

---

## Testing

Run the test suite (requires server running):

```bash
# Start server in one terminal
npm start

# Run tests in another terminal
npm test
```

Individual tests:

```bash
npm run test:signatures    # Thinking signatures
npm run test:multiturn     # Multi-turn with tools
npm run test:streaming     # Streaming SSE events
npm run test:interleaved   # Interleaved thinking
npm run test:images        # Image processing
npm run test:caching       # Prompt caching
```

---

## Troubleshooting

### "Could not extract token from Antigravity"

If using single-account mode with Antigravity:
1. Make sure Antigravity app is installed and running
2. Ensure you're logged in to Antigravity

Or add accounts via OAuth instead: `antigravity-claude-proxy accounts add`

### 401 Authentication Errors

The token might have expired. Try:
```bash
curl -X POST http://localhost:8080/refresh-token
```

Or re-authenticate the account:
```bash
antigravity-claude-proxy accounts
```

### Rate Limiting (429)

With multiple accounts, the proxy automatically switches to the next available account. With a single account, you'll need to wait for the rate limit to reset.

### Account Shows as "Invalid"

Re-authenticate the account:
```bash
antigravity-claude-proxy accounts
# Choose "Re-authenticate" for the invalid account
```

### Docker: Container can't find accounts

Make sure the volume is mounted correctly and `accounts.json` exists:
```bash
ls -la ./data/accounts.json
```

If missing, add accounts first (see Installation section).

---

## Safety, Usage, and Risk Notices

### Intended Use

- Personal / internal development only
- Respect internal quotas and data handling policies
- Not for production services or bypassing intended limits

### Not Suitable For

- Production application traffic
- High-volume automated extraction
- Any use that violates Acceptable Use Policies

### Warning (Assumption of Risk)

By using this software, you acknowledge and accept the following:

- **Terms of Service risk**: This approach may violate the Terms of Service of AI model providers (Anthropic, Google, etc.). You are solely responsible for ensuring compliance with all applicable terms and policies.

- **Account risk**: Providers may detect this usage pattern and take punitive action, including suspension, permanent ban, or loss of access to paid subscriptions.

- **No guarantees**: Providers may change APIs, authentication, or policies at any time, which can break this method without notice.

- **Assumption of risk**: You assume all legal, financial, and technical risks. The authors and contributors of this project bear no responsibility for any consequences arising from your use.

**Use at your own risk. Proceed only if you understand and accept these risks.**

---

## Legal

- **Not affiliated with Google or Anthropic.** This is an independent open-source project and is not endorsed by, sponsored by, or affiliated with Google LLC or Anthropic PBC.

- "Antigravity", "Gemini", "Google Cloud", and "Google" are trademarks of Google LLC.

- "Claude" and "Anthropic" are trademarks of Anthropic PBC.

- Software is provided "as is", without warranty. You are responsible for complying with all applicable Terms of Service and Acceptable Use Policies.

---

## Credits

This project is based on insights and code from:

- [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) - Antigravity OAuth plugin for OpenCode
- [claude-code-proxy](https://github.com/1rgs/claude-code-proxy) - Anthropic API proxy using LiteLLM

---

## License

MIT
