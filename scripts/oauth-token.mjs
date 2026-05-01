// One-shot helper: grab an OAuth 2.1 access token via Authorization Code + PKCE.
//
// Drives a public client through the full browser-login flow against any
// OIDC-discoverable authorization server. No deps beyond Node stdlib.
//
// Usage (from project root):
//   node scripts/oauth-token.mjs \
//     --issuer https://auth.example.com \
//     --client-id my-public-client \
//     --scope "openid mcp-amp-read" \
//     [--port 8765]
//
// The script:
//   1. Discovers the AS endpoints from {issuer}/.well-known/openid-configuration
//   2. Generates PKCE verifier + S256 challenge
//   3. Listens on http://127.0.0.1:<port>/callback
//   4. Prints the authorization URL — open it in a browser, log in
//   5. Captures the code from the redirect, exchanges for a token
//   6. Prints the access token + decoded payload
//
// Configure the AS-side public client with redirect_uri http://127.0.0.1:8765/callback
// (or whatever --port you pass), PKCE required, and the scopes you want to request.

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    out[a.slice(2)] = argv[i + 1];
    i++;
  }
  return out;
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeJwtPayload(token) {
  const [, payload] = token.split(".");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  const json = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return JSON.parse(json);
}

const args = parseArgs(process.argv.slice(2));
const issuer = args.issuer ?? process.env.AS_ISSUER;
const clientId = args["client-id"] ?? process.env.CLIENT_ID;
const scope = args.scope ?? "openid mcp-amp-read";
const port = Number(args.port ?? 8765);
const redirectUri = `http://127.0.0.1:${port}/callback`;

if (!issuer || !clientId) {
  console.error(
    "Usage: node scripts/oauth-token.mjs --issuer <url> --client-id <id> [--scope <s>] [--port <p>]",
  );
  process.exit(2);
}

const discoveryUrl = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
const discResp = await fetch(discoveryUrl);
if (!discResp.ok) {
  console.error(`OIDC discovery failed (${discResp.status}): ${discoveryUrl}`);
  process.exit(1);
}
const disc = await discResp.json();
if (!disc.authorization_endpoint || !disc.token_endpoint) {
  console.error(`discovery doc missing endpoints: ${discoveryUrl}`);
  process.exit(1);
}

const codeVerifier = b64url(randomBytes(32));
const codeChallenge = b64url(createHash("sha256").update(codeVerifier).digest());
const state = b64url(randomBytes(16));

const authUrl = new URL(disc.authorization_endpoint);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("scope", scope);
authUrl.searchParams.set("state", state);
authUrl.searchParams.set("code_challenge", codeChallenge);
authUrl.searchParams.set("code_challenge_method", "S256");

const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const u = new URL(req.url, redirectUri);
    if (u.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const html = (msg) =>
      `<!doctype html><meta charset=utf-8><body style="font-family:system-ui;padding:2rem">${msg}</body>`;
    const err = u.searchParams.get("error");
    if (err) {
      const desc = u.searchParams.get("error_description") ?? "";
      res.writeHead(400, { "content-type": "text/html" }).end(
        html(`<h2>Auth error</h2><pre>${err}: ${desc}</pre>`),
      );
      server.close();
      reject(new Error(`auth error: ${err} ${desc}`));
      return;
    }
    const c = u.searchParams.get("code");
    const s = u.searchParams.get("state");
    if (!c || s !== state) {
      res.writeHead(400, { "content-type": "text/html" }).end(html("<h2>Invalid response</h2>"));
      server.close();
      reject(new Error("missing code or state mismatch"));
      return;
    }
    res
      .writeHead(200, { "content-type": "text/html" })
      .end(html("<h2>Got it. You can close this tab and return to the terminal.</h2>"));
    server.close();
    resolve(c);
  });
  server.on("error", reject);
  server.listen(port, "127.0.0.1", () => {
    console.error(`listening on ${redirectUri}`);
    console.error(`\nopen this URL in your browser:\n\n  ${authUrl}\n`);
  });
});

const tokenResp = await fetch(disc.token_endpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  }),
});
const tokenBody = await tokenResp.json();
if (!tokenResp.ok || !tokenBody.access_token) {
  console.error("token exchange failed:", tokenBody);
  process.exit(1);
}

console.error("\n=== access_token (also on stdout below) ===");
console.log(tokenBody.access_token);
console.error("\n=== decoded payload ===");
console.error(JSON.stringify(decodeJwtPayload(tokenBody.access_token), null, 2));
if (tokenBody.refresh_token) console.error("(refresh_token also returned)");
