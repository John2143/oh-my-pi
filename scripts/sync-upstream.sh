#!/usr/bin/env bash
# Sync fork with upstream: fast-forward main, rebase john, regen nix hashes.
# Run from repo root. Local SSH auth avoids GITHUB_TOKEN workflow-file restrictions.
#
# Usage:
#   scripts/sync-upstream.sh          # full sync + push
#   scripts/sync-upstream.sh --dry-run  # simulate, no push

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
	DRY_RUN=true
	echo "=== DRY RUN — no pushes will be made ==="
	echo
fi

# ── safety checks ──────────────────────────────────────────────
if ! git diff-index --quiet HEAD --; then
	echo "error: working tree is dirty. commit or stash changes first." >&2
	exit 1
fi

START_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# ── fetch upstream ─────────────────────────────────────────────
echo ":: Fetching upstream/main..."
git fetch upstream main

UPSTREAM_SHA=$(git rev-parse upstream/main)
echo "   upstream/main → ${UPSTREAM_SHA:0:9}"

# ── fast-forward main ─────────────────────────────────────────
echo
echo ":: Fast-forwarding main from upstream/main..."

# Detach to main, resetting to origin/main
git checkout --detach origin/main 2>/dev/null || git checkout -b main origin/main
git branch -f main HEAD

if git merge --ff-only upstream/main; then
	git branch -f main HEAD
	echo "   main fast-forwarded to ${UPSTREAM_SHA:0:9}"
else
	# Might be "Already up to date" (exit 0) or diverged (exit non-zero)
	if git merge-base --is-ancestor upstream/main HEAD; then
		echo "   (already up to date)"
	else
		echo "   error: main has diverged from upstream; cannot fast-forward" >&2
		git checkout "$START_BRANCH"
		exit 1
	fi
fi

# ── push main ─────────────────────────────────────────────────
if $DRY_RUN; then
	echo "   [dry-run] would push origin/main"
else
	git push origin main
	echo "   pushed origin/main"
fi

# ── rebase john ────────────────────────────────────────────────
echo
echo ":: Rebasing john onto upstream/main..."

PRE_SHA=$(git rev-parse origin/john)
echo "   pre-rebase john SHA: ${PRE_SHA:0:9}"

git checkout john

REBASE_OK=true
if git rebase upstream/main; then
	echo "   rebase clean"
else
	REBASE_OK=false
	CONFLICTS=$(git diff --name-only --diff-filter=U | tr '\n' ' ')
	git rebase --abort

	echo
	echo "   ╔══════════════════════════════════════════════════════════╗"
	echo "   ║  REBASE CONFLICT                                        ║"
	echo "   ╠══════════════════════════════════════════════════════════╣"
	echo "   ║  Upstream: ${UPSTREAM_SHA:0:9}                          ║"
	printf "   ║  Conflicts: %-45s ║\n" "$CONFLICTS"
	echo "   ╠══════════════════════════════════════════════════════════╣"
	echo "   ║  Resolve manually:                                       ║"
	echo "   ║    git checkout john                                     ║"
	echo "   ║    git rebase upstream/main                              ║"
	echo "   ║    # fix conflicts, git add, git rebase --continue       ║"
	echo "   ║    git push --force-with-lease origin john               ║"
	echo "   ╚══════════════════════════════════════════════════════════╝"
	echo
fi

# ── push john ─────────────────────────────────────────────────
if $REBASE_OK; then
	if $DRY_RUN; then
		echo "   [dry-run] would force-push origin/john"
	else
		git push --force-with-lease origin john
		echo "   pushed origin/john"
	fi
else
	echo "   (push skipped due to conflict)"
fi

# ── regen nix hashes if lockfiles changed ──────────────────────
if $REBASE_OK; then
	echo
	echo ":: Checking for lockfile changes..."

	if git diff --name-only "$PRE_SHA"..HEAD -- bun.lock Cargo.lock | grep -q .; then
		echo "   lockfiles changed, regenerating nix hashes..."
		bash scripts/regen-nix-hashes.sh

		if git diff --quiet -- bun.nix hashes.json; then
			echo "   regen produced no changes"
		else
			git add bun.nix hashes.json
			git commit -m "ci(sync-upstream): regen bun.nix and cargoHash for new lockfiles"

			if $DRY_RUN; then
				echo "   [dry-run] would push origin/john with hash regen"
			else
				git push origin john
				echo "   pushed origin/john (hash regen)"
			fi
		fi
	else
		echo "   no lockfile changes"
	fi
fi

# ── return to starting branch ──────────────────────────────────
git checkout "$START_BRANCH" 2>/dev/null || true

echo
echo "=== sync complete ==="
