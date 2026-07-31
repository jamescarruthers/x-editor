#!/bin/sh
# Restore graphify's per-machine setup on a fresh container.
#
# The knowledge graph itself is committed (graphify-out/graph.json and friends), so nothing here
# rebuilds it. What cannot be committed is the machinery around it: the `graphify` binary lives
# outside the repo, and git hooks live in .git/hooks/, which no clone ever carries. Without this,
# a new container gets a committed CLAUDE.md telling it to run a command that does not exist —
# an authoritative-looking instruction pointing at nothing, which is worse than no instruction.
#
# Deliberately NOT run here: `graphify claude install`. That regenerates .claude/settings.json with
# the absolute path of whatever machine ran it (/root/.local/bin/graphify), which is exactly the
# thing that made the generated file uncommittable. The committed settings.json provides those
# hooks itself, resolving graphify off PATH.
#
# Every failure path exits 0. A session that cannot install a code-navigation aid is a session that
# should still start.
set -u

# uv installs into ~/.local/bin, which is not always on PATH in a fresh shell.
case ":${PATH}:" in
  *":${HOME}/.local/bin:"*) ;;
  *) PATH="${HOME}/.local/bin:${PATH}"; export PATH ;;
esac

if ! command -v graphify >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    uv tool install graphifyy >/dev/null 2>&1 || exit 0
  elif command -v pipx >/dev/null 2>&1; then
    pipx install graphifyy >/dev/null 2>&1 || exit 0
  else
    exit 0
  fi
fi

command -v graphify >/dev/null 2>&1 || exit 0

# Registers the post-checkout refresh and the union merge driver for graph.json. The driver matters
# more than it looks: a tracked graph.json is rewritten on every commit, so two branches that both
# commit will always conflict on it without one.
graphify hook install >/dev/null 2>&1 || true

# Swap graphify's post-commit rebuild for a pre-commit one. Its version runs after the commit is
# written and detached into the background, which cannot work when graph.json is tracked — the
# rebuild lands in the working tree instead of the commit, leaving every commit followed by a dirty
# graph. See .claude/graphify-precommit.sh.
_HOOKS=$(git rev-parse --git-path hooks 2>/dev/null) || _HOOKS=""
if [ -n "$_HOOKS" ] && [ -d "$_HOOKS" ]; then
    rm -f "$_HOOKS/post-commit"
    if [ -f .claude/graphify-precommit.sh ]; then
        cp .claude/graphify-precommit.sh "$_HOOKS/pre-commit" 2>/dev/null || true
        chmod +x "$_HOOKS/pre-commit" 2>/dev/null || true
    fi
fi

exit 0
