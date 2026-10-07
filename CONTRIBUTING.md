# Contributing to CalcInk

## Setup

```bash
npm install
npm run dev
```

Before opening a pull request:

```bash
npm run typecheck && npm test && npm run build
npm run test:e2e   # needs `npx playwright install chromium` once
```

## Branches and pull requests

- `main` is always deployable. GitHub Actions runs CI on every PR and deploys `main` to GitHub Pages.
- Work happens on short-lived branches named by area:
  `feat/<area>`, `fix/<area>`, `perf/<area>`, `test/<area>`, `docs/<topic>`.
- Every branch is merged with a merge commit (`--no-ff`), so the history shows one merge per PR.
- Keep each PR to a single concern, and fill in the PR template (what, why, how it was tested).

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(recognition): bind ÷ dots to their bar
fix(canvas): avoid blank frame on DPR change
perf(ui): drop backdrop blur over the live canvas
test(e2e): airplane-mode reload
docs(architecture): model selection table
```

Scopes in use: `math`, `ink`, `canvas`, `recognition`, `worker`, `model`, `ui`, `storage`, `pwa`, `bench`, `e2e`, `ci`, `docs`.

## Code ownership (suggested split for a 3-person team)

| Area | Paths | Owner |
|---|---|---|
| Canvas, ink and UX | `src/canvas`, `src/ink`, `src/app`, `src/styles` | Member A |
| Recognition and model integration | `src/recognition`, `public/models`, `scripts/` | Member B |
| Math engine, testing and DevOps | `src/math`, `tests/`, `.github/` | Member C |

Cross-area changes need a review from the owner of each area they touch.

## Design rules

- Never block the UI thread: anything heavier than about 1 ms belongs in the worker.
- Strokes are immutable. Express every edit as an `EditCommand` (`added` / `removed`).
- `src/math`, `src/ink` and `src/recognition` (except the client) must not touch the DOM, so they can be tested in Node.
- No network calls at runtime. New assets must be self-hosted and precached.
