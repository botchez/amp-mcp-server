# Contributing

Thanks for considering a contribution. Read the section below first — this repo has a slightly unusual hosting setup that affects how PRs land.

## Hosting model

- **Source of truth**: GitLab — `https://gitlab.darkforge.app/weddins/amp-mcp-server`
- **Public mirror**: GitHub — `https://github.com/eddinsw/amp-mcp-server` (read-only, force-pushed from GitLab)

What this means for contributors:

- PRs are accepted on GitHub, but **merges happen on the GitLab side**. The maintainer pulls your branch locally, pushes to GitLab, and the mirror force-pushes back. Your PR will typically close as "merged via mirror" or with a manual close + commit reference.
- Public history may rebase. The GitLab → GitHub mirror is a force-push, so any independent commits on GitHub get overwritten.
- File issues on **GitHub**, not GitLab. The maintainer runs the GitLab side privately.

## Dev setup

Requires Node 20+.

```bash
git clone https://github.com/eddinsw/amp-mcp-server.git
cd amp-mcp-server
npm install
npm run build
npm test
```

Most tests don't need a real AMP install — auth, middleware, and config tests are fully mocked. The `scripts/smoke-stdio.mjs` end-to-end script needs a working AMP and is optional.

## Submitting a PR

1. Fork on GitHub
2. Branch from `main`
3. Make your change
4. `npm run build && npm test` must pass clean
5. Open a PR against `eddinsw/amp-mcp-server:main`
6. The `pr-test` GitHub Actions workflow runs build + tests on your branch
7. The maintainer reviews; on accept, the change lands via the GitLab merge path

## Likely-to-be-accepted changes

- Bug fixes with a regression test
- New AMP tools wrapping existing REST endpoints (read-only is easier to land; write tools must respect `AMP_ALLOW_WRITES`)
- Auth/security hardening (DPoP, scope-based gating, introspection, etc.)
- Doc improvements

## Out of scope

See "Out of scope" in [AGENTS.md](./AGENTS.md). The big ones: multi-AMP orchestration, MCP resources/prompts, and acting as an OAuth authorization server (login UI, user DB, token issuance).

## Questions

Open a GitHub issue with the `question` label.
