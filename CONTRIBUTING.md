# Contributing

Thanks for considering a contribution!

## Getting started

```sh
bun install
bun test
```

See [docs/development.md](docs/development.md) for the project layout and available scripts.

## Pull requests

- Branch from `main`, keep PRs focused on one change.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, …) — commitlint enforces this in CI, and semantic-release derives versions from it. A `feat:` or `fix:` that lands on `main` releases immediately.
- Before pushing: `bun run lint && bun run fmt:check && bun run typecheck && bun run check:bun-native && bun test`.
- Bun-native rule: use what Bun ships before adding an npm package (`bun test`, `bun build`, `bun run` / `Bun.$`, `Bun.password`, `Bun.YAML`, built-in `.env` loading). `bun run check:bun-native` fails CI when a dependency Bun already replaces is added; a real exception goes in `ALLOWED` in `scripts/check-bun-native.ts` with the reason.
- Add or update tests for behavior changes; keep metric label cardinality bounded (see [docs/metrics.md](docs/metrics.md)).

## Reporting issues

Use the issue templates. For anything security-sensitive (e.g. a way to bypass signature verification), please do not open a public issue — contact the maintainer directly instead.
