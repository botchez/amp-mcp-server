#!/usr/bin/env bash
# stdio launcher: loads AMP credentials from a private env file so they never
# live in the MCP client's config. Override the path with AMP_MCP_ENV_FILE.
set -euo pipefail
ENV_FILE="${AMP_MCP_ENV_FILE:-$HOME/.config/amp-mcp/env}"
[ -r "$ENV_FILE" ] || { echo "amp-mcp-server: cannot read $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a
export NODE_ENV="${NODE_ENV:-production}"
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dist/index.js"
