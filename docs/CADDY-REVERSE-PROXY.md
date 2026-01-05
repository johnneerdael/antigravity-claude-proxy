# Caddy Reverse Proxy Setup

This guide covers how to deploy Antigravity Claude Proxy behind a Caddy reverse proxy with authentication, making it suitable for machine-to-machine consumption via LiteLLM or any OpenAI-compatible client.

## Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────┐
│   LiteLLM /     │────▶│   Caddy         │────▶│  Antigravity Proxy  │
│   OpenAI Client │     │   (Auth + TLS)  │     │  (localhost:8080)   │
└─────────────────┘     └─────────────────┘     └─────────────────────┘
```

**Why Caddy?**
- Automatic HTTPS with Let's Encrypt
- Simple configuration syntax
- Built-in basic auth support
- Proper header handling for streaming (SSE)

## Quick Start

### 1. Docker Compose with Caddy

Create a `docker-compose.yml`:

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
      - DEBUG=false
      - FALLBACK=true
    restart: unless-stopped
    networks:
      - proxy-network

  caddy:
    image: caddy:2-alpine
    container_name: caddy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - antigravity-proxy
    restart: unless-stopped
    networks:
      - proxy-network

volumes:
  caddy_data:
  caddy_config:

networks:
  proxy-network:
    driver: bridge
```

### 2. Caddyfile Configuration

Create a `Caddyfile` in the same directory:

#### Option A: Basic Auth (Recommended for Machine Interfaces)

```caddyfile
# Replace with your domain or use localhost for local testing
api.example.com {
    # Basic authentication for API access
    # Generate hash: caddy hash-password --plaintext "your-secret-key"
    basic_auth {
        # Username: api-user, Password hash below
        api-user $2a$14$HASH_FROM_CADDY_HASH_PASSWORD
    }

    # Reverse proxy to antigravity-proxy container
    reverse_proxy antigravity-proxy:8080 {
        # Required for SSE streaming
        flush_interval -1
        
        # Health checks
        health_uri /health
        health_interval 30s
        health_timeout 5s
    }

    # Security headers
    header {
        -Server
        X-Content-Type-Options "nosniff"
    }
}
```

#### Option B: API Key via Header (Bearer Token Style)

If you want to use an API key in the `Authorization: Bearer` header (more compatible with OpenAI clients):

```caddyfile
api.example.com {
    # Validate Bearer token
    @valid_token {
        header Authorization "Bearer sk-your-secret-api-key"
    }

    # Block requests without valid token
    handle @valid_token {
        reverse_proxy antigravity-proxy:8080 {
            flush_interval -1
            health_uri /health
            health_interval 30s
        }
    }

    # Reject unauthorized requests
    handle {
        respond "Unauthorized" 401
    }

    header {
        -Server
    }
}
```

#### Option C: Multiple API Keys

For multiple users/services with different API keys:

```caddyfile
api.example.com {
    @token1 header Authorization "Bearer sk-user1-key"
    @token2 header Authorization "Bearer sk-user2-key"
    @token3 header Authorization "Bearer sk-service-key"

    handle @token1 {
        reverse_proxy antigravity-proxy:8080 {
            flush_interval -1
            header_up X-User-ID "user1"
        }
    }

    handle @token2 {
        reverse_proxy antigravity-proxy:8080 {
            flush_interval -1
            header_up X-User-ID "user2"
        }
    }

    handle @token3 {
        reverse_proxy antigravity-proxy:8080 {
            flush_interval -1
            header_up X-User-ID "service"
        }
    }

    handle {
        respond "Unauthorized" 401
    }
}
```

#### Option D: Local Development (No TLS)

For local testing without a domain:

```caddyfile
:8443 {
    basic_auth {
        api $2a$14$HASH_FROM_CADDY_HASH_PASSWORD
    }

    reverse_proxy antigravity-proxy:8080 {
        flush_interval -1
    }
}
```

### 3. Generate Password Hash

```bash
# Generate a password hash for basic auth
docker run --rm caddy:2-alpine caddy hash-password --plaintext "your-secret-api-key"

# Output will be something like:
# $2a$14$Zkq...
```

### 4. Start the Stack

```bash
# Add accounts first (if not already done)
docker run -it --rm \
  -v $(pwd)/data:/root/.config/antigravity-proxy \
  ghcr.io/johnneerdael/antigravity-claude-proxy:latest \
  node bin/cli.js accounts add --no-browser

# Start the stack
docker-compose up -d

# Verify
curl -u api-user:your-secret-api-key https://api.example.com/health
```

---

## LiteLLM Configuration

### Connecting LiteLLM to Caddy-Protected Proxy

#### Option A: Basic Auth

Create `litellm-config.yaml`:

```yaml
model_list:
  # Claude models via Caddy-protected proxy
  - model_name: claude-sonnet-4-5-thinking
    litellm_params:
      model: openai/claude-sonnet-4-5-thinking
      api_base: https://api-user:your-secret-api-key@api.example.com/v1
      api_key: "not-needed"

  - model_name: claude-opus-4-5-thinking
    litellm_params:
      model: openai/claude-opus-4-5-thinking
      api_base: https://api-user:your-secret-api-key@api.example.com/v1
      api_key: "not-needed"

  - model_name: claude-sonnet-4-5
    litellm_params:
      model: openai/claude-sonnet-4-5
      api_base: https://api-user:your-secret-api-key@api.example.com/v1
      api_key: "not-needed"

  # Gemini models
  - model_name: gemini-3-flash
    litellm_params:
      model: openai/gemini-3-flash
      api_base: https://api-user:your-secret-api-key@api.example.com/v1
      api_key: "not-needed"

  - model_name: gemini-3-pro-high
    litellm_params:
      model: openai/gemini-3-pro-high
      api_base: https://api-user:your-secret-api-key@api.example.com/v1
      api_key: "not-needed"
```

#### Option B: Bearer Token Auth

If using the Bearer token Caddyfile configuration:

```yaml
model_list:
  - model_name: claude-sonnet-4-5-thinking
    litellm_params:
      model: openai/claude-sonnet-4-5-thinking
      api_base: https://api.example.com/v1
      api_key: "sk-your-secret-api-key"  # This becomes Bearer token

  - model_name: claude-opus-4-5-thinking
    litellm_params:
      model: openai/claude-opus-4-5-thinking
      api_base: https://api.example.com/v1
      api_key: "sk-your-secret-api-key"
```

#### Option C: Using Environment Variables (Recommended)

```yaml
model_list:
  - model_name: claude-sonnet-4-5-thinking
    litellm_params:
      model: openai/claude-sonnet-4-5-thinking
      api_base: os.environ/ANTIGRAVITY_API_BASE  # https://api.example.com/v1
      api_key: os.environ/ANTIGRAVITY_API_KEY    # sk-your-secret-api-key
```

Then set environment variables:

```bash
export ANTIGRAVITY_API_BASE="https://api.example.com/v1"
export ANTIGRAVITY_API_KEY="sk-your-secret-api-key"
```

---

## Full Production Stack

### Docker Compose with LiteLLM

Complete stack with Antigravity Proxy, Caddy, and LiteLLM:

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
      - DEBUG=false
      - FALLBACK=true
    restart: unless-stopped
    networks:
      - internal

  caddy:
    image: caddy:2-alpine
    container_name: caddy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - antigravity-proxy
    restart: unless-stopped
    networks:
      - internal
      - external

  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    container_name: litellm
    ports:
      - "4000:4000"
    volumes:
      - ./litellm-config.yaml:/app/config.yaml
    command: ["--config", "/app/config.yaml", "--port", "4000"]
    environment:
      - LITELLM_MASTER_KEY=sk-litellm-master-key
      # For internal network access (bypasses Caddy)
      - ANTIGRAVITY_INTERNAL_URL=http://antigravity-proxy:8080/v1
    restart: unless-stopped
    networks:
      - internal

volumes:
  caddy_data:
  caddy_config:

networks:
  internal:
    driver: bridge
  external:
    driver: bridge
```

### Caddyfile for Production

```caddyfile
# API endpoint for external consumers
api.example.com {
    # Bearer token authentication
    @valid_token {
        header Authorization "Bearer {$API_SECRET_KEY}"
    }

    handle @valid_token {
        reverse_proxy antigravity-proxy:8080 {
            flush_interval -1
            
            transport http {
                dial_timeout 5s
                response_header_timeout 120s
            }
            
            health_uri /health
            health_interval 30s
            health_timeout 5s
        }
    }

    handle {
        respond "Unauthorized" 401
    }

    header {
        -Server
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
    }

    log {
        output file /var/log/caddy/api.log
        format json
    }
}

# Health check endpoint (no auth required)
api.example.com/health {
    reverse_proxy antigravity-proxy:8080
}
```

---

## Direct OpenAI SDK Usage

### Python

```python
from openai import OpenAI

# Option A: Basic Auth in URL
client = OpenAI(
    base_url="https://api-user:your-secret-key@api.example.com/v1",
    api_key="not-needed"
)

# Option B: Bearer Token
client = OpenAI(
    base_url="https://api.example.com/v1",
    api_key="sk-your-secret-api-key"
)

response = client.chat.completions.create(
    model="claude-sonnet-4-5-thinking",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### cURL

```bash
# Basic Auth
curl -u api-user:your-secret-key \
  https://api.example.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5-thinking",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Bearer Token
curl https://api.example.com/v1/chat/completions \
  -H "Authorization: Bearer sk-your-secret-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5-thinking",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## Claude Code CLI Configuration

For using Claude Code CLI through the Caddy proxy:

### With Basic Auth

Edit `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "not-needed",
    "ANTHROPIC_BASE_URL": "https://api-user:your-secret-key@api.example.com",
    "ANTHROPIC_MODEL": "claude-sonnet-4-5-thinking"
  }
}
```

### With Bearer Token

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-your-secret-api-key",
    "ANTHROPIC_BASE_URL": "https://api.example.com",
    "ANTHROPIC_MODEL": "claude-sonnet-4-5-thinking"
  }
}
```

---

## Troubleshooting

### Streaming Not Working

Ensure your Caddyfile includes:

```caddyfile
reverse_proxy backend:8080 {
    flush_interval -1  # Disables buffering for SSE
}
```

### 502 Bad Gateway

Check if the antigravity-proxy container is running:

```bash
docker-compose logs antigravity-proxy
curl http://localhost:8080/health  # Direct access
```

### Certificate Issues

Caddy automatically provisions certificates. If having issues:

```bash
# Check Caddy logs
docker-compose logs caddy

# Ensure ports 80 and 443 are accessible from the internet
# Ensure DNS is pointing to your server
```

### Authentication Failures

```bash
# Test basic auth
curl -v -u api-user:password https://api.example.com/health

# Test bearer token
curl -v -H "Authorization: Bearer sk-your-key" https://api.example.com/health
```

### Timeout on Long Requests

Increase timeouts in Caddyfile:

```caddyfile
reverse_proxy antigravity-proxy:8080 {
    transport http {
        dial_timeout 5s
        response_header_timeout 300s  # 5 minutes for long responses
    }
}
```

---

## Security Best Practices

1. **Use strong API keys**: Generate random keys with `openssl rand -hex 32`
2. **Rotate keys regularly**: Update Caddyfile and client configs periodically
3. **Monitor access logs**: Enable Caddy logging to track usage
4. **Restrict network access**: Only expose Caddy, keep proxy on internal network
5. **Use environment variables**: Don't commit secrets to version control
6. **Enable rate limiting**: Consider Caddy rate limit plugins for production

```caddyfile
# Example with environment variable for API key
api.example.com {
    @valid_token {
        header Authorization "Bearer {$API_SECRET_KEY}"
    }
    # ...
}
```

Then run with:

```bash
API_SECRET_KEY="sk-your-secret" docker-compose up -d
```
