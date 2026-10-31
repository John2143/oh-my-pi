# Oh My Pi Fork Patches

Rebased onto `upstream/main` tip (`83774c81bc`, 2026-11-09, version 18.18.2 plus 53 commits). This documents every change we maintain, why it exists, and where to find it.


The fork carries two patches. Everything else the fork used to ship was either absorbed by upstream or is no longer wanted.

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

## No Longer Carried

- **Nix build system** — upstream ships `flake.nix`, `nix/package.nix`, `nix/bun.nix`, `nix/dev-shell.nix`, `nix/home-manager.nix`, `nix/nixos-module.nix` and exposes `packages.<system>.omp`, so the dotfiles wrapper resolves against upstream's own derivation. The old `nix/omp.nix` + `#private`-field sed workarounds for bun 1.3.13 are obsolete.
- **DeepSeek web-search backport** — native in v18 (`packages/coding-agent/src/web/search/provider.ts`); `providers.webSearch: deepseek` is valid without a patch.
- **Skill-in-loop routing** — upstream fixed it natively: `armLoopAutoSubmit` (`modes/interactive-mode.ts`) plus callers in `input-controller.ts` and `ui-helpers.ts` re-arm the loop for `/skill:` commands that dispatch inline.
- **Anthropic fingerprint commits** (`claudeCodeVersion` bump, OAuth custom Anthropic models) — `claudeCodeVersion` is gone from the provider; `claude-code-fingerprint.ts` adopts the version the server demands, and `auth: oauth` on a custom provider is allowed in `config/models-config.ts`.
- **`inspect_image` tool** — the fork shipped `tools/inspect-image.ts`, its two prompts, a renderer, a collab-web renderer and a test. Upstream retired the tool and built the capability into `read`: `read <image>?q=<question>` answers via a vision model resolved `@vision` -> `@default` -> active model (`utils/image-question.ts`, timeout `images.questionTimeoutMs`). v18 also migrates the old `inspect_image.*` settings away (`config/settings.ts`), so the dotfiles key was removed rather than ported.

## Replay Instructions

```bash
git remote add upstream https://github.com/can1357/oh-my-pi.git
git fetch upstream main
git checkout -B john upstream/main

git cherry-pick 575efc857a   # exit_loop_mode
git cherry-pick e40e18ff02   # read-only config in setup scenes
```

The `exit_loop_mode` patch conflicts on the import block of
`packages/coding-agent/src/modes/controllers/event-controller.ts`: upstream
replaced `recoverAskQuestions` with `recoverAskHtml` + the html-form helpers.
Resolve by keeping upstream's imports and appending
`import type { ExitLoopModeDetails } from "../../tools/exit-loop-mode";`.
Everything else auto-merged onto 18.18.2.

Expect the same class of conflict on a later upstream: the anchors are
`HIDDEN_TOOL_NAMES`, `HIDDEN_TOOLS`, the `toolSession` literal, the eager `goal`
registration block, `requestedActiveToolNames`, `AgentSession`'s mode-state
accessors, `#enableLoopMode`/`disableLoopMode`, and `#handleToolExecutionEnd`.
The setup patch anchors are the three `await ctx.settings.flush()` /
`await settings.flush()` call sites plus `markSetupWizardComplete` in
`modes/setup.ts`.

## Notes for the Nix consumer

18.15+ added `update.auto` (background self-update). `canSelfUpdate()` returns
false for anything under `/nix/store`, so the setting and its setup scene are
skipped for the dotfiles install — updates have to arrive through the flake
input. `providers.webSearch` is retired and migrated into `modelRoles.web`, and
`.omp/agent/settings.json` is read only as a legacy migration source into
`config.yml`.

The tag `fork-v16-pre-v18` pins the abandoned 16.3.11 tree (all 12 old fork
commits) if an old branch is ever needed.
