# Development

## Prerequisites

[Bun](https://bun.sh) ≥ 1.3. Everything else is a dev dependency.

## Setup

```sh
bun install
RESEND_WEBHOOK_SECRET=whsec_test bun run dev   # watch mode on :8080
```

## Scripts

| Command                             | Purpose                                               |
| ----------------------------------- | ----------------------------------------------------- |
| `bun run dev`                       | Run with file watching                                |
| `bun test`                          | Run the test suite                                    |
| `bun run lint`                      | oxlint                                                |
| `bun run fmt` / `bun run fmt:check` | oxfmt format / verify                                 |
| `bun run typecheck`                 | `tsc --noEmit`                                        |
| `bun run build`                     | Compile a standalone binary to `dist/resend-exporter` |

CI runs lint, format check, typecheck, tests, a Docker build, `helm lint`, and commitlint on every PR.

## Project layout

```
src/
  index.ts     entry point: config, signals, startup log
  server.ts    Bun.serve routes (webhook, /metrics, /healthz, /readyz)
  webhook.ts   signature verification, payload parsing, metrics + log emission
  metrics.ts   prom-client registry and metric definitions
  domains.ts   to_domain bucketing allowlist
  config.ts    zod env schema
  logger.ts    JSON line logger
tests/         bun:test suites (handler, server, config, domains)
charts/        Helm chart
examples/      Prometheus + Grafana configs used by compose.yaml
```

## Testing webhooks locally

The test helpers sign payloads with the real Svix scheme, so you don't need actual Resend traffic. To test manually end-to-end, run a tunnel (`ngrok http 8080`) and create a Resend webhook pointed at it — or POST a payload signed with `tests/helpers.ts`'s `signPayload`.

## Releases

Releases are fully automated with semantic-release on every push to `main`:

- `fix:` → patch, `feat:` → minor, `feat!:`/`BREAKING CHANGE:` → major
- `docs:`, `chore:`, `ci:`, etc. → no release

A release publishes, in one pipeline: the GitHub release with changelog and standalone binaries, the multi-arch Docker image (`ghcr.io/robbeverhelst/resend-exporter`), and the Helm chart (`oci://ghcr.io/robbeverhelst/charts/resend-exporter`) — all with the same version. Because every qualifying merge to `main` releases immediately, keep PRs coherent: they are the batching unit.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) and are enforced by commitlint in CI.
