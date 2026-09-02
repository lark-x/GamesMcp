# Typecheck Report — Baseline ce5d2a3

> Date: 2026-09-01 Asia/Shanghai
> Repo: lark-x/GamesMcp
> Baseline commit: ce5d2a3eccf1ee4786f732b0a4865629ceb41b56
> Environment: macOS, Node 22+, pnpm 11.1.2, local checkout of ce5d2a3

## Result

pnpm typecheck exited 0. No TypeScript errors reproduced locally on the baseline commit.

## Error Table

| #   | Error file              | Line | TS code | Root cause                                                                                   | Fix                                   | Regression test |
| --- | ----------------------- | ---- | ------- | -------------------------------------------------------------------------------------------- | ------------------------------------- | --------------- |
| -   | none reproduced locally |      |         | Remote CI reported failure per completion plan NEW-001; not reproducible in this environment | None applied; no local failure to fix | n/a             |

## Local Gate Matrix

| Gate       | Command           | Result                                                |
| ---------- | ----------------- | ----------------------------------------------------- |
| Typecheck  | pnpm typecheck    | PASS exit 0                                           |
| Unit tests | pnpm test         | PASS 119 of 119                                       |
| Lint       | pnpm lint         | PASS exit 0                                           |
| Format     | pnpm format:check | PASS                                                  |
| Build      | pnpm build        | PASS all packages                                     |
| Remote CI  | gh run list       | NOT VERIFIED sandboxed network blocked api.github.com |

## Root-cause Note

NEW-001 claims main CI typecheck failure. On the exact baseline commit ce5d2a3, local tsc -b
produces zero errors. The discrepancy is most likely one of:

1. The failing CI run used a different commit, e.g. a post-ce5d2a3 push. Unverified.
2. Environment-specific dependency drift. Unlikely: pnpm-lock.yaml is committed and CI installs from it.
3. Flaky or cached CI state. Unverified.

Decision: no code changes under Sprint 0.2. The report records local green plus remote unverified.
Sprint 0.3 CI regression is blocked on network access to api.github.com; re-run there when
network is available. Local gates remain the enforcement point for this branch.
