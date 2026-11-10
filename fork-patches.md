# Oh My Pi Fork Patches

Rebased onto `upstream/main` tip (`83774c81bc`, 2026-11-09, version 18.18.2 plus 53 commits). This documents every change we maintain, why it exists, and where to find it.


The fork carries three patches. Everything else the fork used to ship was either absorbed by upstream or is no longer wanted.

## Patch 1: exit_loop_mode Tool (`575efc857a`)

**Why**: Upstream's `/loop` mode auto-repeats a prompt but the agent has no way to stop on its own — only the user can exit (Esc or `/loop` again). Our skills (`web-researcher`, `security-engineer`) run inside `/loop` and need to end the loop themselves once the work is verifiably complete, so the agent gets a tool for it.

**Behaviour**:
- Hidden tool. Registered in the registry from session creation but excluded from the initial active set, so it is never advertised at startup.
- `/loop` activates it by name and withdraws it on exit; `disableLoopMode` is the single teardown point, so a time limit, a condition, a second `/loop`, or a tool-driven exit all deactivate it.
- A successful call ends loop mode and surfaces the agent's `summary` on the status line as `Loop mode exited by agent. <summary>`.
- Called while loop mode is off, it throws `Loop mode is not active.` — the guard covers the window between loop teardown and registry withdrawal.

**Files** (+193/−6):
- `packages/coding-agent/src/tools/exit-loop-mode.ts` (65) — NEW: `ExitLoopModeTool`. Optional `summary` param, `"+": "reject"` closed schema, `approval = "read"`, `concurrency = "exclusive"` (ending a loop reshapes the next turn, so it never shares a batch).
- `packages/coding-agent/src/prompts/tools/exit-loop-mode.md` (8) — NEW: tool description, rendered through `prompt.render`.
- `packages/coding-agent/src/tools/builtin-names.ts` (+1/−1) — `exit_loop_mode` added to `HIDDEN_TOOL_NAMES`.
- `packages/coding-agent/src/tools/index.ts` (+4) — import, `HIDDEN_TOOLS` factory, `ToolSession.isLoopModeEnabled?`.
- `packages/coding-agent/src/sdk.ts` (+21/−1) — `toolSession.isLoopModeEnabled` backed by the session; eager registration (`createTools:exit_loop_mode:session`) placed before the blanket `ExtensionToolWrapper` pass, mirroring the `goal` block; name filtered out of `requestedActiveToolNames` so it starts inactive.
- `packages/coding-agent/src/session/agent-session.ts` (+10) — `#loopModeEnabled`, `isLoopModeEnabled()`, `setLoopModeEnabled()`.
- `packages/coding-agent/src/modes/interactive-mode.ts` (+39/−3) — `#enableLoopMode` became async and awaits `#activateLoopExitTool()` so iteration 1 already advertises the tool; `disableLoopMode` stays synchronous and fires `#deactivateLoopExitTool()` without awaiting.
- `packages/coding-agent/src/modes/controllers/event-controller.ts` (+9) — in `#handleToolExecutionEnd`, a successful `exit_loop_mode` calls `ctx.disableLoopMode(...)` with the agent's summary.
- `packages/coding-agent/test/tools/exit-loop-mode.test.ts` (41) — NEW: refuses when loop mode is off; reports summary; falls back without one.

**Port notes vs the 16.3.11 version** (`74ac4a051`): v18 declares `disableLoopMode` synchronous across ~6 call sites, so it was not ported to async — deactivation is fire-and-forget there and the tool's own guard covers the gap. Activation is awaited instead, because `setActiveToolsByName` drops unknown names and a raced activation would hide the tool during iteration 1. Registration is eager rather than lazy: it runs before the blanket `ExtensionToolWrapper` pass, so the entry gets the approval gate like every other built-in.

## Patch 2: read-only config in setup scenes (`e40e18ff02`)

**Why**: `Settings.flush()` rethrows write failures by contract — the upstream settings tests assert rejections for `ELOOP`, `ENOTDIR` and invalid configs — and all three setup-scene flushes awaited it unguarded. A home-manager-managed `config.yml` is a symlink into the read-only nix store, so finishing the setup wizard rejected with `EROFS` and the TUI reported it as an unhandled rejection (the write lands next to the *resolved* target, i.e. inside `/nix/store`). Selectors and the session-move path already catch this and show a clean error; only the wizard was unguarded.

**Files**:
- `packages/coding-agent/src/modes/setup.ts` — `flushSetupSettings()` helper logs `Setup: failed to persist settings`; `selectModel`, `saveComposerShape` and `markSetupWizardComplete` route through it, so the in-memory setting still advances and only persistence is skipped.
- `packages/coding-agent/test/setup-wizard-readonly-config.test.ts` — NEW: symlinks `config.yml` into an unwritable directory and asserts completion warns rather than rejects, with nothing written to the store.

**Port note**: the first attempt guarded `flush()` itself; that widens a documented contract and breaks the upstream rejection tests, so the guard belongs at the UI call site instead.

## Patch 3: NixOS portability (`51c2abe7bb`, `bf688a4e4c`)

**Why**: `_resolve_bash()` in `packages/coding-agent/src/eval/py/runner.py` returned
the hardcoded `/bin/bash` on every non-Windows host. NixOS has no `/bin/bash` (only
`/bin/sh`), so every `%%bash` cell failed with `FileNotFoundError`, which the runner
reports as an error frame *without* stdout/stderr — `Python runner shell output
streaming` then failed with "Received: undefined" rather than a useful message.
Hosted runners are FHS, so upstream CI never sees it.

**Fix**: `shutil.which("bash") or "/bin/bash"` — PATH first, FHS path as fallback.
The same commit set also fixes a test fixture: `browser-attach.test.ts` wrote a
distro-wrapper script with a `#!/bin/bash` shebang, so spawning it failed with
ENOENT before the wrapper could exec. It now uses `#!/usr/bin/env bash`, matching
the fixtures in `config-value-fd-inheritance.test.ts`.

**Worth upstreaming**: this is a genuine portability bug, not a fork preference.
Verified by running `packages/coding-agent/test/eval/py/runner-shell-output.test.ts`
on NixOS: 2 failing cases before, 7/7 after.

## Patch 4: FHS programs on a stat-blind /bin

**Why**: NixOS has no FHS `/bin`. `services.envfs` (dotfiles, the `github` runner
VM) serves `/bin/<tool>` for `execve` by resolving `<tool>` in the *requesting*
process's `PATH`, and falls back to a directory of the common tools when the
process has no `PATH` at all. Two gaps survived, both only reachable from the
Rust suite (`bun run test` runs `cargo nextest` as one more chunk):
- `pi-builtins`' command runner `stat(2)`ed an absolute `argv[0]` before
  spawning it. envfs answers `execve`, never `stat`, so `/bin/pwd` — find's
  `-exec` fixture, `find::tests::exec_uses_shell_cwd_and_captures_child_stdout`
  — read as missing and the test failed with "Failed to run /bin/pwd: No such
  file or directory" without ever spawning anything.
- `pi-vcs`' git-runner fixtures assert their process group with
  `alias.pgid=!ps -o pgid= -p $$`, and the dev shell had no `procps`, so git's
  shell answered "ps: command not found".
- envfs sets a process's `comm` to the path it was asked for, so a sleeper
  started as `/bin/sleep` reported name `/bin/sleep`, not `sleep`. `pi-shell`'s
  spawn and cancel fixtures match that bare name, so they timed out waiting for
  a `sleep` that never appeared.
- Two fixtures ran a *bare* command from a `PATH`-less shell (`cat /dev/fd/63`
  in `one_way_extra_fds_can_be_opened_by_path`, `exec sleep 30` in rsync's
  "stuck rsh"). A shell resolves those by `stat(2)`ing each `PATH` entry, which
  envfs cannot answer, so both exited 127.

**Fix**: `locate()` now treats a `NotFound` stat on a name containing `/` as
"let the spawn decide": the spawn reports the same ENOENT when the program
really is absent, so nothing is masked. `parse_stat` keeps the last component of
`comm`, which is what every FHS system reports. `procps` joins the dev shell
packages, and the two fixtures use absolute paths.

**Verified by**: `cargo nextest run -p pi-builtins -E 'test(exec_uses_shell_cwd)'`
and the `pi-vcs` git-runner tests on the `github` runner VM, which is the only
machine with envfs.

**Worth upstreaming**: the `locate()` change is a real portability fix for any
`execve`-only filesystem; the dev-shell one is NixOS-specific.

## Patch 5: wait for the prompt before typing ^D (`zle_pty.rs`)

**Why**: `eof_on_an_empty_line_exits` typed ^D the moment obash was spawned.
While the terminal is still canonical, the line discipline turns that ^D into a
zero-byte EOF marker, which is lost when ZLE switches the terminal to raw mode,
so the shell sat at its prompt until the 10 s timeout. It fails every run when
the test runs alone, on office and on the runner, so load is not the cause. A
pty driver hung 2/2 with no delay, and exited every time after ≥50 ms. Upstream
CI never sees it because the Rust chunk self-skips on `main`.

**Fix**: wait for the prompt on screen before typing ^D, as a user would.

**Verified by**: 30/30 exits in a standalone pty driver after a prompt wait, and
`cargo nextest run -p pi-shell --test zle_pty -E 'test(eof_on_an_empty_line_exits)'`
5/5 (70 ms each; 10.4 s timeout before).

**Worth upstreaming**: yes — a test race, not a fork preference.

## No Longer Carried

- **Nix build system** — upstream ships `flake.nix`, `nix/package.nix`, `nix/bun.nix`, `nix/dev-shell.nix`, `nix/home-manager.nix`, `nix/nixos-module.nix` and exposes `packages.<system>.omp`, so the dotfiles wrapper resolves against upstream's own derivation. The old `nix/omp.nix` + `#private`-field sed workarounds for bun 1.3.13 are obsolete.
- **DeepSeek web-search backport** — native in v18 (`packages/coding-agent/src/web/search/provider.ts`); `providers.webSearch: deepseek` is valid without a patch.
- **Skill-in-loop routing** — upstream fixed it natively: `armLoopAutoSubmit` (`modes/interactive-mode.ts`) plus callers in `input-controller.ts` and `ui-helpers.ts` re-arm the loop for `/skill:` commands that dispatch inline.
- **Anthropic fingerprint commits** (`claudeCodeVersion` bump, OAuth custom Anthropic models) — `claudeCodeVersion` is gone from the provider; `claude-code-fingerprint.ts` adopts the version the server demands, and `auth: oauth` on a custom provider is allowed in `config/models-config.ts`.
- **`inspect_image` tool** — the fork shipped `tools/inspect-image.ts`, its two prompts, a renderer, a collab-web renderer and a test. Upstream retired the tool and built the capability into `read`: `read <image>?q=<question>` answers via a vision model resolved `@vision` -> `@default` -> active model (`utils/image-question.ts`, timeout `images.questionTimeoutMs`). v18 also migrates the old `inspect_image.*` settings away (`config/settings.ts`), so the dotfiles key was removed rather than ported.

## Replay Instructions

The branch is a plain rebase of three fork commits onto `upstream/main`:

```bash
git fetch upstream main
git checkout -B john upstream/main
git log --oneline upstream/main..origin/john   # the fork commits, oldest first
git cherry-pick <exit_loop_mode> <read-only-setup-config> <bash-from-path>
```

That is exactly what `.github/workflows/fork-sync.yml` does on a schedule
(`git rebase upstream/main`), so a clean upstream bump needs no manual replay at
all — only a conflict does.

The `exit_loop_mode` patch conflicts on the import block of
`packages/coding-agent/src/modes/controllers/event-controller.ts` whenever
upstream reshapes that block: keep upstream's imports and append
`import type { ExitLoopModeDetails } from "../../tools/exit-loop-mode";`.

Expect the same class of conflict on a later upstream: the anchors are
`HIDDEN_TOOL_NAMES`, `HIDDEN_TOOLS`, the `toolSession` literal, the eager `goal`
registration block, `requestedActiveToolNames`, `AgentSession`'s mode-state
accessors, `#enableLoopMode`/`disableLoopMode`, and `#handleToolExecutionEnd`.
The setup patch anchors are the three `ctx.settings.flush()` call sites plus
`markSetupWizardComplete` in `modes/setup.ts`.

## Fork-only CI (`.github/workflows/fork-sync.yml`)

The fork's default branch is `john`, so the daily sync workflow lives here
(scheduled workflows only run from the default branch). It rebases onto
`upstream/main` and runs `bun run ci:check:full`, `bun run build:native` and
`bun run test` with `OMP_TEST_CONCURRENCY=8`. Pooled mode also reports every
failing chunk instead of stopping at the first. It force-pushes `john` only if
all of that passes; otherwise it comments on the "fork-sync: john needs
attention" issue. A manual `force=true` dispatch re-verifies the current tip.

The self-hosted runner (`github-runner-oh-my-pi` on the `github` VM,
dotfiles `nixos/github-configuration.nix`) must provide, or the suite fails:
- `util-linux` on PATH (`setsid`/`unshare`, packages/utils ptree tests);
- HOME no longer than 27 characters (tui task-progress-render asserts
  `$HOME/private/file` survives a 40-column preview); the workDir is
  `/var/lib/containers/omp`;
- `RestrictSUIDSGID=false` (edit-tool-details chmods a fixture to 04750);
- `services.envfs.enable` so FHS paths (`/bin/bash`, `/usr/bin/<tool>`) in
  upstream fixtures resolve, with `extraFallbackPathCommands` carrying
  coreutils/procps for the Rust fixtures that spawn `/bin/sh -c '/bin/sleep …'`
  under an empty environment. envfs answers `execve` but not `stat`, which is
  why Patch 4 exists; `bash-interactive.test.ts` only runs when `/bin/bash`
  exists.

dotfiles' `.github/workflows/bump-omp.yml` picks up a new `john` daily at
07:47 UTC. It builds omp through the dotfiles flake, pushes it to attic, then
commits the lock.

## Notes for the Nix consumer

18.15+ added `update.auto` (background self-update). `canSelfUpdate()` returns
false for anything under `/nix/store`, so the setting and its setup scene are
skipped for the dotfiles install — updates have to arrive through the flake
input. `providers.webSearch` is retired and migrated into `modelRoles.web`, and
`.omp/agent/settings.json` is read only as a legacy migration source into
`config.yml`.

The tag `fork-v16-pre-v18` pins the abandoned 16.3.11 tree (all 12 old fork
commits) if an old branch is ever needed.
