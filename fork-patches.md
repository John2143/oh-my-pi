# Oh My Pi Fork Patches

Rebased onto `upstream/main` tip (`ac2ea80fa`, 2026-07-07). This documents every change we maintain, why it exists, and where to find it.

## Commit 1: Nix Build System (`c2af1f9bd`)

**Why**: bun 1.3.13 from nixpkgs cannot `bun build --compile` upstream's code — #private field syntax, older Node.js built-in handling, and missing `$env`/`$flag` globals require runtime polyfills.

**Files**: `nix/omp.nix` (232 lines), `bun.nix` (2,225 lines), `flake.nix`, `flake.lock`, `hashes.json`, `.gitignore`

**What it does**:
- Runs from source tree (no bundling) via `bun --preload env-polyfill.ts`
- `postPatch` phase: sed patches convert `#private` fields to `_private` for bun 1.3.13
- Polyfills `$env` and `$flag` globals that newer bun provides but 1.3.13 doesn't
- Builds Rust native addon via cargo, copies `.node` file into packages/natives/native/
- Uses `preferLocalBuild = true` and `--external '*'` for transpilation
- Version and cargoHash managed in `hashes.json`

## Commit 2: exit_loop_mode Tool (`74ac4a051`)

**Why**: Upstream's `/loop` mode auto-repeats a prompt but the agent has no way to stop on its own. Only the user can exit (Esc or `/loop` again). This adds a tool so the agent can call `exit_loop_mode` when it determines work is complete.

**Files**:
- `tools/exit-loop-mode.ts` (54 lines) — NEW: Hidden tool class. Called with optional `summary` param.
- `prompts/tools/exit-loop-mode.md` (8 lines) — NEW: Tool prompt.
- `tools/index.ts` (+4 lines) — Import, factory in HIDDEN_TOOLS, re-export, ToolSession method.
- `sdk.ts` (+14 lines) — Always registers in registry, filters from initial active set (activated by handleLoopCommand).
- `agent-session.ts` (+8 lines) — `#loopModeEnabled` field, `isLoopModeEnabled()`, `setLoopModeEnabled()`.
- `event-controller.ts` (+9 lines) — After tool execution: if tool is "exit_loop_mode" and not error, calls `disableLoopMode()`.
- `interactive-mode.ts` (+26 lines) — `disableLoopMode()` now async, calls `session.setLoopModeEnabled(false)` and deactivates tool; `handleLoopCommand()` activates tool via `session.setActiveToolsByName`.
- `test/tools/loop-mode-tools.test.ts` (42 lines) — NEW
- `test/tools/index.test.ts` (+2 lines) — Added "exit_loop_mode" to HIDDEN_TOOLS assertion.

## Commit 3: Skill-in-Loop Routing (`c4188eb8e`)

**Why**: `/loop /skill:investigation "..."` only works on iteration 1 (skill loaded via editor submit). Iteration 2+ sends raw `/skill:...` text to `session.prompt()` — the skill content is never loaded. This routes loop auto-submits through the skill loader.

**Files**:
- `interactive-mode.ts` (+10 lines) — In `#runLoopIteration()`: before calling `onInputCallback`, check if prompt is a `/skill:` command. If so, route through `invokeSkillCommandFromText()`, then resolve callback with `{ started: false }` (skill already sent content).
- `input-controller.ts` (+10 lines) — After `#invokeSkillCommand` returns true in Enter handler: if loop mode active, resolve `onInputCallback` so main loop advances. In submit path: capture `loopPrompt` when loop mode is active.

## Commit 4-7: Fixes, Changelog, Formatting

- `6a47978e1` — Fix: exit_loop_mode handler was outside method body (syntax error)
- `398f5a041` — Changelog entries
- `94d6c4cd3` — Biome import ordering

## What We Dropped vs Old Fork

From the old 65-commit fork, these are gone:
- 60 Nix debug commits → condensed into 1
- 15 dead CI workflow commits → manual script only
- Dead extension status segment (8 files, broken, no callers)
- `session-manager.ts` `getRecentSessions` re-export (dead code)
- `.claude/scheduled_tasks.lock` (accidental commit)
- Corrupted `oauth-flow.ts` from rebase (upstream has correct version)
- `messages.ts`, `transcript-render-helpers.ts`, `ui-helpers.ts` (restored from upstream)

## Replay Instructions

```bash
# To re-apply these patches on a fresh upstream checkout:
git remote add upstream https://github.com/can1357/oh-my-pi.git
git fetch upstream main
git checkout -b john upstream/main

# Apply each commit:
git cherry-pick c2af1f9bd  # Nix build
git cherry-pick 74ac4a051  # exit_loop_mode
git cherry-pick c4188eb8e  # skill-in-loop
git cherry-pick 6a47978e1  # fix: handler inside method body
git cherry-pick 398f5a041  # changelog
git cherry-pick 94d6c4cd3  # import ordering
```
