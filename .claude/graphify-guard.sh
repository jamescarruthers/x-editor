#!/bin/sh
# Steer searches and reads toward the knowledge graph, when there is one.
#
# A thin wrapper rather than calling `graphify hook-guard` directly from settings.json, for two
# reasons. It resolves graphify off PATH instead of baking in the absolute path of the machine that
# generated the config — the difference between a file that survives a clone and one that does not.
# And it no-ops when graphify is absent, which is the state of every session between the container
# starting and SessionStart finishing its install.
#
# Runs before every Bash, Grep, Read and Glob, so it must stay cheap and must never block a tool
# call: an exit status other than 0 would turn a missing optional aid into a broken session.
set -u

case ":${PATH}:" in
  *":${HOME}/.local/bin:"*) ;;
  *) PATH="${HOME}/.local/bin:${PATH}"; export PATH ;;
esac

command -v graphify >/dev/null 2>&1 || exit 0

graphify hook-guard "${1:-read}" 2>/dev/null || true
exit 0
