# Developing and testing Vortex with AI

Use this kit for automated testing, reproducing and fixing bugs, implementing
features, comparing implementations to design documentation, and checking UI
behavior across window sizes and application states. Start with
[the operating manual](AGENTS.md), [known pitfalls](../KNOWLEDGE.md), and the
relevant skill in [`.claude/skills`](../.claude/skills/).

## Vortex's own AI documentation is required reading

Before editing Vortex, read and follow the source checkout's `AGENTS.md` and
any applicable nested instructions. Read `CLAUDE.md` when present and follow its
references. Start at `docs/README.md` for the documentation index; do not assume
that this harness's notes supersede Vortex's current instructions.

The current source tree routes these tasks to:

| Task                              | Vortex reference, relative to its checkout                                   |
| --------------------------------- | ---------------------------------------------------------------------------- |
| Source layout and build setup     | `CONTRIBUTING.md`, `docs/repo-layout.md`                                     |
| React, UI, styling, accessibility | `docs/frontend.md`, `CODESTYLE.md`                                           |
| State changes and reducers        | `docs/state.md`                                                              |
| Regression and component tests    | `docs/testing.md`                                                            |
| Debugging and runtime diagnostics | `docs/DEBUGGING-GUIDE.md`                                                    |
| Design-system page work           | `docs/design-system/page-migration.md` and the supplied design specification |
| Collections and install flows     | `docs/mod-management/collections.md`                                         |
| Deployment and external changes   | `docs/mod-management/EXTERNAL-CHANGES.md`                                    |

Consult the checkout's index if paths move. Report missing design inputs or
contradictions explicitly; use the task's stated behavior as the acceptance
criteria. Do not silently replace a supplied design with a generic layout.

## Reproduce, change, verify

1. Identify the target: stock Vortex for an automation-tool issue; the source
   checkout for a Vortex application change. Record the version/commit, game,
   profile, current page, and relevant state.
2. Use the sandbox for local install/deploy/purge tests. Use an explicitly
   configured real game for game-specific behavior or game launch. Authentication
   is a setup concern; do not repeatedly ask for credentials while implementing.
3. Reproduce the symptom through MCP UI actions. Capture a before screenshot,
   a focused UI snapshot, relevant state, and renderer errors. Poll the specific
   outcome rather than sleeping for a guessed duration.
4. Add a regression assertion which fails for the original behavior. Put pure
   extension DOM tests in `src/uiAutomation.test.ts`, harness logic tests beside
   the implementation, Vortex code tests in the owning Vortex project, and real
   app workflows in `harness/src/tests/`.
5. Make the smallest complete change in the correct repository. Rebuild the
   relevant output. Renderer changes can be reloaded; main-process changes
   require a restart. Verify the new renderer lifetime before driving it.
6. Repeat the reproduction and assert the outcome independently: Playwright for
   rendered behavior, filesystem contents for deployment, a live game process
   for game launch. A tool returning success alone does not establish the result.
7. Run the repository's required checks and the relevant real-app tests. Record
   exactly which passed, failed, or were blocked, with artifact paths. Update the
   skill/manual when the workflow changed and add non-obvious findings to
   `KNOWLEDGE.md`.

If the kit cannot carry out a requested step, extend its reusable tools or
fixtures and cover that capability with tests. Do not leave a successful manual
experiment as the only way to reproduce a result. Preserve compatibility with
released Vortex; process control and CDP belong in the harness.

For exploring before that, `vortex-ai script <file.mts>` runs a scratch script against the kit
under the instance lease, and `vortex-ai eval --expr "<js>"` inspects a harness renderer (see
"Scratch scripts and renderer diagnostics" in AGENTS.md). Their results are leads; the check
that settles a question is the one added to the kit.

Timing a change that affects rendering: compare against an in-build control that the change
does not touch. For the Mods table that is the classic layout. Another page is no control, since
the Mods page stays mounted while hidden (KNOWLEDGE.md).

## Before a Vortex pull request is ready

A draft PR is not done until each of these is true and stated in its description:

1. **Reproduced and A/B-verified** in the real app, unpatched against patched. Use the same
   commit and the same `--fresh` baseline, with the relevant opt-in check or scenario.
   Timings come from `--production` builds, so React runs as it does for users; `up` fails
   unless the renderer loaded production React (`automation_status.react`).
2. **Vortex's full gate passes on the PR's exact commit.** Run `pnpm run verify`, and
   confirm the formatter left the tree clean. Stop the harness instance first, because
   verify rewrites `src/main/build`.
3. **The E2E suite has run** with the kit's runner, master first as the baseline:
   `pnpm run ai:vortex-e2e -- --owner <you> --checkout <dir>` on master, then the PR's head
   with `--compare <master report.json>`. It runs `packages/e2e` as CI does, with the
   fixture's startup race patched for the run only, and leaves out the account specs when
   their credentials are absent (they need Nexus test accounts and VPN). Report its
   regressions separately from pre-existing failures and the credential-skipped count,
   and give both HEAD shas.
4. **An independent agent has reviewed it adversarially**: the whole diff, claims and
   evidence, trying to break equivalence and find undisclosed behaviour changes. Fix or
   answer every confirmed point, then re-verify.

"Not run" is not an acceptable line in a PR description. If a gate cannot run here, say
exactly what blocked it.

Titles, the description template, the reviewer brief and the lessons log are in
[PULL-REQUESTS.md](PULL-REQUESTS.md). After every review, add any recurring class of finding to
its "Review lessons", so the next author checks for it before pushing.

## Several issues at once: orchestrate, don't accumulate

A report often names several problems: a slow deploy, a crash, a missing warning. Working them all in
one context degrades it. Findings, logs and diffs from one issue leak into reasoning about the next,
and review points get lost. Split the work:

- **The orchestrator** (the session the user is talking to) triages the report into one task per
  issue, keeps the list of open PRs and their state, and owns this kit. **It is the only agent that
  edits `vortex-mcp`**: the harness, the extension, KNOWLEDGE.md, the skills and these docs. It gives
  each agent its owner name, worktree and slot, and runs the gates that need a quiet machine (A/B
  timing, the final E2E baseline).
- **One fresh subagent per issue or PR** does the Vortex-side work in its own worktree and its own
  slot: reproduce, fix, test in the app, typecheck, lint, commit, push. Give it a self-contained
  brief (PULL-REQUESTS.md, "Fix agent brief"): owner name, worktree, slot, branch, the problem
  statement, and any review findings as a file path, not pasted history. It must not edit the kit
  or the PR description.
- **A separate fresh agent does QA and adversarial review on each pushed PR**, in a slot of its own.
  It reproduces the problem on the base by itself, confirms the fix in the app, tries to break it,
  then reviews the diff (see PULL-REQUESTS.md). The orchestrator sends confirmed findings back to a
  new fix agent, and the cycle repeats until QA and review find nothing blocking.

This separates using the kit to develop Vortex from improving the kit itself.

### Kit lessons come back to the orchestrator

Parallel agents editing KNOWLEDGE.md or a skill would overwrite each other, and a lesson written
mid-task is often half-understood. So agents don't write them. Every subagent's final report ends
with a **Kit lessons** section: each non-obvious behaviour it lost time to, each missing capability
it worked around, each doc that was wrong, with the evidence. When there are none, it says so. The
orchestrator reads them as reports come in, checks each one, and turns it into a kit change, test
and doc entry (AGENTS.md, "Every automation request improves the automation kit"). The next agent
it briefs inherits them. A subagent that is blocked on a missing capability stops and reports it
rather than improvising a private workaround.

### Running agents in parallel: a worktree and a slot each

Several agents can drive Vortex at once, each on its own project, as long as none shares a checkout,
a cache or a port with another (harness/AGENTS.md, "Parallel sessions"):

```powershell
# the orchestrator, once per agent
pnpm run ai -- worktree add fix-24290 --base upstream/master
# in the agent's brief: its owner, worktree and slot, on every command
pnpm run ai -- up --owner fix-24290 --worktree fix-24290 --slot auto --bethesda-sandbox
pnpm run ai -- screenshot --owner fix-24290 --slot auto --label repro
pnpm run ai -- down --owner fix-24290 --slot auto
```

- **A worktree per agent** (`.vortex-worktrees/<name>`): its own branch, `node_modules` and build.
  A Vortex running from it locks it (`checkout:<dir>`), so nobody rebuilds it underneath. Nobody
  works in `.vortex-src` itself; it is the clone the worktrees come from, and may hold someone's
  uncommitted work.
- **A slot per agent** (`--slot auto` with its owner name, or `VORTEX_AI_SLOT=auto` and
  `VORTEX_AI_OWNER` in its environment): its own cache, artifacts, MCP and CDP ports and instance
  lease. The owner keeps the same slot, with its warm profile, across commands. `vortex-ai slots`
  shows who has which.
- `pnpm run verify`, `vortex-e2e` and `ai:test` run in the agent's own worktree and slot. Two
  `vortex-e2e` runs never overlap: they share a lease of their own, so one waits for the other.
- **Timing is not parallel.** Other instances compete for CPU, so an A/B measurement taken while
  other agents build or drive Vortex is noise. The orchestrator runs timing gates with the machine
  otherwise idle, and says so in the PR.
- Each worktree installs its own dependencies (a few minutes and a few GB), and Windows path
  limits still apply, so keep worktree names short. Remove a finished one with
  `worktree remove <name>`; its branch stays.

Leases still guard what is shared. `up`, `down`, `setup`, `ai:test` and the `ai:test:*` scripts
take their slot's instance lease and refuse, naming the holder, while another owner has it. Wrap
anything else that uses Vortex in `lease run --owner <name> --slot <n> -- <command>`. A refused
command changed nothing; wait (`--wait`) rather than releasing another owner's lease.

## Implementing a feature from a design

Translate the supplied design into explicit acceptance criteria before changing
code: information hierarchy, spacing, typography, control behavior, empty/error
states, keyboard access, overflow rules, and resize behavior. Reference the
specific design page or section in the test or verification notes.

Build on Vortex's existing components and conventions from `docs/frontend.md`
and its design-system guidance. Capture the implementation at the design's
reference size and at neighboring sizes. Compare screenshots visually as well
as checking DOM/state behavior. Structural layout heuristics cannot verify
typography, icon choice, color, or fidelity to a reference image.

## Width, height, and state matrix

Resize both dimensions. A list that works at a narrow width may still hide its
footer in a short window. Run the same width at different heights to expose
vertical clipping; run the same height at different widths to expose wrapping.
Record the actual window and renderer sizes because the OS may clamp requests.

```powershell
pnpm run ai -- responsive --screenshots --viewports "1024x720,1280x720,1280x1000,1920x1080"
```

Run a sweep in each relevant state, using a distinct `--label` for artifacts:

| State                             | What to verify                                   |
| --------------------------------- | ------------------------------------------------ |
| Empty list / first run            | Setup guidance and primary action remain visible |
| Populated or virtualized list     | Filtering, scrolling, selection, row actions     |
| Thousands of mods                 | `ai:test:large-library`, `ai:test:mods-scroll`   |
| Long names or localized text      | Wrapping, truncation, accessible names           |
| Selection / expanded details      | Actions stay reachable; focus remains useful     |
| Modal / stacked modal / installer | Dialog scope, scrollable body, footer actions    |
| Loading / disabled / failure      | Progress, retry, cancellation, useful errors     |
| Signed out / authenticated        | Correct setup affordances without repeated login |

For repeatable state setup, use documented Redux actions/events via
`vortex_dispatch` and verify the resulting state. Use the UI when a private
dialog callback is only reachable through controls. Avoid editing Vortex's
database or depending on a production user's mods. Put recurring scenarios in
Playwright tests with explicit fixtures and cleanup.

Layout scan findings are candidates for review, not automatic proof of a bug.
An intentional scroll container or small icon can be flagged at every size;
an issue found only at one size still needs visual confirmation. Preserve the
original window size on success and failure.

## Verification boundaries

`pnpm run ci` checks this kit without launching Vortex. `pnpm run ai:test`
launches a real app with an isolated profile and disposable sandbox game. Neither
proves an authenticated Nexus collection downloads or a purchased game launches;
those require the additional setup and explicit collection/game scenario.

When working in `.vortex-src`, follow its own verification instructions. In
particular, do not overwrite a live development renderer with a production
verification build; use its documented checks and stop/restart the development
session when appropriate. Do not commit, push, or open a PR unless asked.
