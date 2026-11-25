# Development workflow

`trunk` is protected. Nothing is pushed to it directly; every change arrives
through a pull request whose verification has passed.

## Making a change

1. Branch from an up-to-date `trunk`.
2. Commit. The `pre-commit` hook runs `oxfmt --check` and `oxlint`.
3. Push. The `pre-push` hook runs `bun run verify`: oxlint, oxfmt, `tsc`, and Vitest.
4. Open a pull request into `trunk`. The Verification workflow runs.
5. GitHub merges the pull request once **Verification gate** is green and there are no
   conflicts, then deletes the remote branch.

`bun run submit` performs steps 3 and 4 and enables automatic merging. The title and
description come from the commits. Later pushes to the same branch need only `git push`.
To enable automatic merging on an existing pull request, run `gh pr merge --auto --merge`.

The next `git pull` on `trunk` deletes the merged local branch. Use merge commits: after a
squash or rebase merge, the local branch is retained and must be deleted manually.

## Git hooks

Hooks live in `.githooks/` and are enabled by `bun install`, whose `prepare` script
sets `core.hooksPath` and `fetch.prune`. To enable them manually, run `bun run prepare`.

| Hook         | Checks                                               |
| :----------- | :--------------------------------------------------- |
| `pre-commit` | `bun run format:check`, `bun run lint`               |
| `pre-push`   | `bun run verify` (lint, format check, `tsc`, Vitest) |

Hooks check the working tree, not only the staged content. They can be skipped with
`--no-verify`, so they are a convenience; the server-side checks below are the enforcement.

## Verification workflow

`.github/workflows/verification.yml` runs on pull requests into `trunk`, on pushes to
`trunk`, and on demand. Each job reports its own status:

| Job                | Command                                          |
| :----------------- | :----------------------------------------------- |
| Lint (oxlint)      | `bun run lint`                                   |
| Format (oxfmt)     | `bun run format:check`                           |
| Typecheck (tsc)    | `bun run check`                                  |
| Test (vitest)      | `bun run test`                                   |
| Build (preview)    | `bun run build` with `CLOUDFLARE_ENV=preview`    |
| Build (production) | `bun run build` with `CLOUDFLARE_ENV=production` |
| Verification gate  | Succeeds only if every job above succeeded       |

Actions are pinned to commit SHAs, the workflow has read-only `contents` permission, and
no secrets. Deployment is not part of this workflow; see [deployment](deployment.md).
The Playwright browser suite is also excluded because it targets a live site.

## Branch protection

The `trunk` ruleset (Settings → Rules → Rulesets, "Protect trunk") applies to everyone,
with no bypass actors:

- Changes require a pull request, with all review conversations resolved.
- **Verification gate** must pass. The branch need not be current with `trunk`; the
  Verification run on each push to `trunk` detects incompatibilities between changes
  that merged separately.
- Force pushes and branch deletion are blocked.

Release tags (`vX.Y.Z`) are not affected; production deployment still requires a tag on a
commit already in `origin/trunk`.
