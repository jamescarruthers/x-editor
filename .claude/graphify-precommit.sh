#!/bin/sh
# Rebuild the knowledge graph and stage it, so it lands in the commit that changed the code.
#
# This replaces graphify's own post-commit hook, which cannot work once graph.json is tracked. That
# hook runs *after* the commit is written, so the rebuild accounting for a commit necessarily lands
# in the working tree rather than in it: every commit left graph.json modified, and clearing it took
# a second, empty commit. Moving the rebuild in front of the commit makes the graph and the code it
# describes the same revision, which is the only arrangement where a committed graph is worth
# anything.
#
# Three properties this must have, in order of importance:
#
#   1. It never blocks a commit. Every failure path exits 0. A stale graph is a nuisance; a commit
#      you cannot make because a code-navigation aid is broken is a much worse one.
#   2. It is synchronous. graphify's own hook detaches into the background, which is right for
#      post-commit and wrong here — a backgrounded rebuild would still be running when git writes
#      the tree, and would stage nothing.
#   3. It does not recurse. A commit touching only graphify-out/ needs no rebuild, and rebuilding
#      anyway would dirty the tree again on every such commit.
set -u

[ "${GRAPHIFY_SKIP_HOOK:-0}" = "1" ] && exit 0

# Mid-rebase, mid-merge and mid-cherry-pick, staging extra files would derail `--continue`.
_GIT_DIR=${GIT_DIR:-$(git rev-parse --git-dir 2>/dev/null)}
[ -d "$_GIT_DIR/rebase-merge" ] && exit 0
[ -d "$_GIT_DIR/rebase-apply" ] && exit 0
[ -f "$_GIT_DIR/MERGE_HEAD" ] && exit 0
[ -f "$_GIT_DIR/CHERRY_PICK_HEAD" ] && exit 0

# Property 3: nothing but graph output staged means nothing to re-extract.
_STAGED=$(git diff --cached --name-only 2>/dev/null)
[ -z "$_STAGED" ] && exit 0
_NON_GRAPH=$(printf '%s\n' "$_STAGED" | grep -v '^graphify-out/' || true)
[ -z "$_NON_GRAPH" ] && exit 0

case ":${PATH}:" in
  *":${HOME}/.local/bin:"*) ;;
  *) PATH="${HOME}/.local/bin:${PATH}"; export PATH ;;
esac
command -v graphify >/dev/null 2>&1 || exit 0

# Louvain iterates string-keyed sets whose order PYTHONHASHSEED randomizes per process, so without
# this the community assignments churn between runs and every commit shows a graph.json diff that
# means nothing. graphify's own hook pins it for the same reason.
PYTHONHASHSEED=0
export PYTHONHASHSEED

# AST only — deterministic, no LLM, no API key, no network. Documents and images are deliberately
# not re-extracted here: that needs semantic extraction, which is far too slow and too expensive to
# sit in front of every commit. `/graphify <path> --update` covers those by hand, and CLAUDE.md says
# so. The graph is built from the working tree, so it can reflect unstaged edits too; that errs
# toward describing the code as it now is, which is the harmless direction.
graphify update . >/dev/null 2>&1 || exit 0

# Ignored paths are skipped by git add, so the machine-specific and transient files stay out.
git add graphify-out 2>/dev/null || true

exit 0
