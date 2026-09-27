# Agent instructions

This repo is **doodlebot**, an agentic development and testing tool for Vortex. It holds the
tools, the harness, the docs and the hard-won knowledge. Nothing here requires a patched or
self-built Vortex.

## What's here

| Path                       | What it is                                                                 |
| -------------------------- | -------------------------------------------------------------------------- |
| `src/`                     | The Vortex extension: an MCP server exposing Vortex's state **and** its UI |
| `harness/`                 | The `doodlebot` CLI and Playwright suite: launch, cache, drive, verify     |
| `harness/AGENTS.md`        | **The operating manual.** Start here to use any of this                    |
| `harness/WORKFLOWS.md`     | Bug fixes, features, designs, state matrices, several agents at once       |
| `harness/PULL-REQUESTS.md` | Vortex PR titles, description template, agent briefs, review lessons       |
| `KNOWLEDGE.md`             | Vortex behaviours that fail silently. Read before debugging                |
| `ARCHITECTURE.md`          | Why the extension reflects Vortex's API instead of wrapping it             |
| `.claude/skills/`          | Skills: developing Vortex, driving its UI, writing UI tests                |
| `.vortex-src/`             | The Vortex clone this kit manages (gitignored, created by `ai:source`)     |
| `.vortex-worktrees/`       | One worktree of it per piece of work (gitignored, `worktree add <name>`)   |

## Getting to a driveable Vortex

```bash
pnpm install
pnpm run build                                # build the extension
pnpm run ai -- setup --installed --sandbox    # no game or account required
pnpm run ai -- tools --json                   # live tool schemas
```

To work on Vortex's own code: `pnpm run ai:source` finds **your** GitHub fork, clones it into
`.vortex-src` and builds it. Then `pnpm run ai -- worktree add <name>` makes a worktree of it for
each piece of work. The kit never searches the filesystem for a Vortex checkout.

Collections need a Nexus login, once per machine: `pnpm run ai -- setup --installed --oauth`.
The account owner completes the browser login; the kit caches and refreshes it. See
`harness/AGENTS.md`.

## Verification

- `pnpm run ci` is the gate: types (extension and harness), lint, format check, unit tests,
  build. It needs no Vortex.
- `pnpm run ai:test` runs the Playwright suite against a real Vortex, with a disposable test
  game and no account. It is outside `ci` because it needs Electron.
- Say which one you ran. Passing unit tests alone is not evidence that a Vortex workflow works.
- oxfmt and oxlint own formatting and lint. Don't hand-fix them.

## Every automation request improves the kit

When asked to perform or test something in Vortex:

1. Read `harness/AGENTS.md` and the relevant skills. Read `KNOWLEDGE.md` before diagnosing a
   failure, and `ARCHITECTURE.md` to decide where a missing capability belongs. When changing
   Vortex, also follow its own `AGENTS.md`, `CLAUDE.md` and `docs/README.md`: this kit
   supplements Vortex's rules and doesn't replace them.
2. Inspect the live tool schemas, state and UI before acting. Use existing capabilities first.
3. If the kit lacks a capability, implement it here: an extension tool, harness orchestration or
   setup support. Keep it compatible with stock Vortex. Don't stop at describing the gap, or
   leave a private workaround the next agent can't reuse.
4. Verify it through the real app, add regression coverage, and update the manual, skill and
   knowledge entries.
5. Keep missing automation apart from external constraints. Login, captcha, unavailable
   services and missing software can't be claimed away: report them with the exact setup step.

A task is complete only when its result is verified, or a concrete external blocker is reported.

## Working on this repo

- **Many doodlebots, no orchestrator.** Any number of sessions can work at once, each on its own
  issue, in its own worktree and instance slot (`worktree add <name>`, then `--owner <name>
--worktree <name> --slot auto`), each looking after its own review and PR. **Changes to this
  kit (knowledge, skills, harness, docs) happen only under the kit lock:** `kit lock`, `kit sync`,
  edit, `pnpm run ci`, commit, `kit push`, `kit unlock`. See `harness/WORKFLOWS.md`, "Several
  agents at once".
- **The extension must keep working against a stock, released Vortex.** Anything that needs the
  main process goes in the harness over CDP, never into a patch to Vortex.
- **Two test layers.** Pure DOM logic goes in `src/uiAutomation.test.ts` under jsdom; anything
  that needs a real app goes in `harness/src/tests/`.
- **Add to KNOWLEDGE.md** when something non-obvious cost real time. Keep entries short:
  symptom, cause, fix.
- Extension changes hot-reload into a running instance: `pnpm run ai:watch` alongside
  `pnpm run dev`.

## Committing

Conventional Commits. Don't commit, push or open a PR unless asked, except for kit lessons you apply
under the kit lock (`kit push`). Every Vortex PR description
ends with the doodlebot footer (`harness/PULL-REQUESTS.md`).
