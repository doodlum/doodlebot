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

For exploring before that, `doodlebot script <file.mts>` runs a scratch script against the kit
under the instance lease, and `doodlebot eval --expr "<js>"` inspects a harness renderer (see
"Scratch scripts and renderer diagnostics" in AGENTS.md). Their results are leads; the check
that settles a question is the one added to the kit.

An A/B of a renderer-only change, when base and head share the main process: in one checkout,
`git checkout --detach <sha>`, rebuild `src/renderer` (`pnpm exec webpack --config
./webpack.config.cjs`) and the CSS (`pnpm run tailwind` in `src/stylesheets`, then copy
`dist/tailwind-v4.css` to `src/main/build/assets/css/`), reload with `eval --expr
"location.reload()"`, and capture both sides with one script. It saves a second full build. Set
`webFrame.setZoomFactor(1)` and blur focus first, so a saved zoom level or a focus ring left by a
previous step doesn't differ between the sides.

Timing a change that affects rendering: compare against an in-build control that the change
does not touch. For the Mods table that is the classic layout. Another page is no control, since
the Mods page stays mounted while hidden (KNOWLEDGE.md).

## Before a Vortex pull request is ready

**Open even a draft PR only when it is ready to be looked at**: the author's
evidence is complete, `pnpm run verify` passed on the head, the adversarial QA has given its
verdict and its findings are addressed, and anything visible has before/after clips. A pushed
branch is not a PR. Until then, work and review happen on the branch. The user is told the branch
is ready for review, not shown a PR that will change under them.

A draft PR is not done until each of these is true and stated in its description:

1. **Reproduced and A/B-verified** in the real app, unpatched against patched. A change anyone can
   see (UI, scrolling, animation) has short before/after clips attached, recorded with `record`. Use the same
   commit and the same `--fresh` baseline, with the relevant opt-in check or scenario.
   Timings come from `--production` builds, so React runs as it does for users; `up` fails
   unless the renderer loaded production React (`automation_status.react`).
2. **A change to rendering, scrolling or input is measured for responsiveness, and a regression
   blocks it.** On an otherwise idle machine, with a `--production` build of the base and the
   head: the longest frame gap and the p95 during a scrollbar drag, a wheel flick and a track
   click, and the longest task, over at least 3 runs a side (`ai:test:mods-scroll`, and a
   per-frame drag probe). Then try it by hand. A fix that trades a visible bug for lag (blank rows
   for a 9 fps drag) is not a fix, and "the machine was shared" is a reason to measure again, not to
   open the PR.
3. **Vortex's full gate passes on the PR's exact commit.** Run `pnpm run verify`, and
   confirm the formatter left the tree clean. Stop the harness instance first, because
   verify rewrites `src/main/build`.
4. **The E2E suite has run** with the kit's runner, master first as the baseline:
   `pnpm run ai:vortex-e2e -- --owner <you> --checkout <dir>` on master, then the PR's head
   with `--compare <master report.json>`. It runs `packages/e2e` as CI does, with the
   fixture's startup race patched for the run only, and leaves out the account specs when
   their credentials are absent (they need Nexus test accounts and VPN). Report its
   regressions separately from pre-existing failures and the credential-skipped count,
   and give both HEAD shas.
5. **An independent agent has reviewed it adversarially**: the whole diff, claims and
   evidence, trying to break equivalence and find undisclosed behaviour changes. Fix or
   answer every confirmed point, then re-verify.

"Not run" is not an acceptable line in a PR description. If a gate cannot run here, say
exactly what blocked it. The description ends with the doodlebot footer, and
`pnpm run ai:preflight -- --pr <number>` checks both.

Titles, the description template, the reviewer brief and the lessons log are in
[PULL-REQUESTS.md](PULL-REQUESTS.md). After every review, add any recurring class of finding to
its "Review lessons", so the next author checks for it before pushing.

## Several agents at once: each looks after itself

Any number of doodlebot sessions can run at the same time, each working on its own issue. There is
no orchestrator: each session triages, fixes, verifies, reviews and opens the PR for its own work,
and keeps to its own worktree, slot and owner name. What they share is guarded by leases:

| Shared thing                                   | Guard                                              |
| ---------------------------------------------- | -------------------------------------------------- |
| A Vortex instance (cache, ports)               | its slot's instance lease (`--slot auto`)          |
| A Vortex checkout                              | `checkout:<dir>`, held while a Vortex runs from it |
| This repo: KNOWLEDGE.md, skills, harness, docs | **the kit lock** (`kit lock` … `kit push`, below)  |
| Vortex's own E2E suite                         | the `vortex-e2e` lease                             |

One issue per context still holds. A report that names several problems gets one session (or one
fresh subagent) per problem, because findings, logs and diffs from one issue leak into reasoning
about the next. A session that spawns subagents for its own issue — a fix agent, a QA agent — briefs
them with the templates in PULL-REQUESTS.md and gives each its own worktree and slot.

### Changing the kit: take the kit lock

Every session improves the kit as it goes (AGENTS.md, "Every automation request improves the kit"),
but the kit is one working tree and one `main`, so only one session changes it at a time:

```powershell
pnpm run ai -- kit lock --owner <you> --wait 30   # waits while another session holds it
pnpm run ai -- kit sync --owner <you>             # switch to main, fast-forward to origin/main
# edit KNOWLEDGE.md, a skill, the harness or the docs; pnpm run ci; git commit
pnpm run ai -- kit push --owner <you>             # rebase onto origin/main, push main
pnpm run ai -- kit unlock --owner <you>
```

- Take the lock **before the first edit**, not just to push: an edit in the shared working tree is
  visible to every other session at once. Keep the window short: note lessons as you work, then
  apply them together under one lock.
- `kit push` refuses without the lock, with uncommitted changes, or off `main`. The lock lapses after
  30 minutes unless taken again (`--ttl`), so a session that dies can't hold it for long.
  `kit status` shows who has it.
- Never leave kit edits uncommitted after releasing the lock, and never edit the kit from a
  subagent without the lock. Subagents may still report **Kit lessons** to the session that briefed
  them; that session applies them under the lock.

### Running agents in parallel: a worktree and a slot each

Several agents can drive Vortex at once, each on its own project, as long as none shares a checkout,
a cache or a port with another (harness/AGENTS.md, "Parallel sessions"):

```powershell
pnpm run ai -- worktree add fix-24290 --base upstream/master
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
  lease. The owner keeps the same slot, with its warm profile, across commands. `doodlebot slots`
  shows who has which.
- `pnpm run verify`, `vortex-e2e` and `ai:test` run in the agent's own worktree and slot. Two
  `vortex-e2e` runs never overlap: they share a lease of their own, so one waits for the other.
- **Timing needs a quiet machine.** Other instances compete for CPU, so a measurement taken while
  other sessions build or drive Vortex is noise. Before timing, check `doodlebot slots` and wait
  until no other instance is running; say in the PR what else was running, if anything.
- **Keep your windows off the user's screen when you can.** Keep your instance down when idle, and
  capture with as few setting or layout switches as possible (each can flash the window).
- Each worktree installs its own dependencies (a few minutes and a few GB), and Windows path
  limits still apply, so keep worktree names short. Remove a finished one with
  `worktree remove <name>`; its branch stays.

A refused command changed nothing; wait (`--wait`) rather than releasing another owner's lease.

### Review starts when the design is settled

While the user is still shaping a change (choosing between variants, asking for new ones), the work
isn't ready for QA. Don't start or keep a reviewer on it: every new direction makes its findings
stale, and its Vortex is one more window on the user's screen. Iterate, let the user try a demo, and
start QA only when the user says the design is settled (or the change has no design questions).
Pause a running reviewer as soon as the direction changes.

### A reviewer runs only the head it reviews

A reviewer that keeps a Vortex up on an older head, while the author works on a newer one, puts a
window with an outdated design on the user's screen, and it looks like the author's work went wrong.
Review the head you were given. When a new one is pushed, `down`, move your worktree to it
(`worktree add <name> --ref origin/<branch>` makes a detached one), and only then `up` again.

### A build for the user to try gets its own worktree

When the user wants to try a branch, don't run their Vortex from the author's worktree. It locks the
checkout, so the author can't rebuild it, and `pr-preflight`'s revert check is refused. Make one for
them: `worktree add demo-<topic> --ref origin/<branch>`, `up --owner user-demo --worktree
demo-<topic> --slot auto`. Leave it running until they're done. To show them a new head, `down`,
`git -C <demo worktree> checkout --detach <sha>`, rebuild, and `up` again.

### Revisiting closed PRs: the doodlebot queue

An upstream PR the user closed with no draft on their fork hasn't been looked at by a doodlebot yet:
queue it, one session each. Read the PR, its diff and its thread, **and the linked Linear issue's
comments**, where maintainers often give the reason for closing and the GitHub thread stays empty.
Check whether the problem still exists on current upstream/master, then either redo the fix on a
fresh branch (cherry-picking the old one where it still applies, and addressing the feedback), or
write down why no draft is needed. Both outcomes close the queue entry.
`gh pr view <n> --json title,body,comments,reviews,state,closedAt` is more reliable than
`--comments`.

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
