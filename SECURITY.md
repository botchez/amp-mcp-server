# Security policy

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Use GitHub's [private security advisory feature](https://github.com/eddinsw/amp-mcp-server/security/advisories/new) — that creates a private channel with the maintainer and tracks the disclosure timeline.

Please include:
- A description of the vulnerability and its potential impact
- Steps to reproduce (and a minimal proof-of-concept if possible)
- The affected version(s)

You can expect an initial acknowledgement within 7 days. Critical issues are patched as quickly as practical; lower-severity issues may be batched into the next release.

## Supported versions

Only the latest minor version receives security patches.

| Version | Supported |
|---|---|
| 0.2.x | ✅ |
| < 0.2 | ❌ |

## Threat model

`amp-mcp-server` exposes a CubeCoders AMP install's control plane to MCP clients. The trust assumptions:

- **AMP credentials are highly sensitive.** `AMP_PASSWORD` (or remembered-token) gives full control over every game-server instance the account can manage. Treat the env file like a password file.
- **HTTP without auth is loopback-only.** `MCP_AUTH_MODE=none` plus a public bind is refused at startup unless explicitly overridden — but the override exists, so reviewing your deployment is your responsibility.
- **OAuth tokens have full access to all registered tools** (subject to `AMP_ALLOW_WRITES`). Per-tool scope gating is on the v0.3 roadmap; until then, if a token is issued at all, it can call every registered tool.
- **AMP itself is not hardened by this project.** `amp-mcp-server` is only as secure as the AMP install behind it. Audit your AMP user accounts and roles separately.
- **No data is stored or logged.** Tokens are validated and discarded per request; AMP credentials live only in process memory after `AmpClient.fromEnv()`. Logs are structured and go to stderr; they include the JWT `sub` claim in OAuth mode for traceability but never the token itself.

## Out of scope

- Vulnerabilities in `@neuralnexus/ampapi`, `@modelcontextprotocol/sdk`, or other upstream dependencies should be reported to those projects directly. We update transitive dependencies during normal release cadence.
- Vulnerabilities in CubeCoders AMP itself are not in this project's scope.
- Misconfigurations are not vulnerabilities. If `MCP_ALLOW_INSECURE=true` exposes your server, that's by design — the override exists only because we can't anticipate every legitimate deployment topology.
