#!/usr/bin/env bash
set -u

# Cross-platform node-locator shim for ClaudeVisual's bundled hook scripts.
# Mirrors ~/.claude/hooks/node-hook-runner.sh's proven lookup order (node ->
# node.exe -> common Windows install locations via cygpath under Git-Bash)
# so a missing Node.js runtime never turns into a startup crash loop —
# native Claude Code installs don't bundle `node`.
#
# Usage: runner.sh <hook-script.cjs> [args...]   (stdin is passed through via exec)

HOOK_SCRIPT="${1:-}"
if [ -z "$HOOK_SCRIPT" ]; then
  exit 0
fi
shift || true

run_with_node() {
  local node_bin="$1"
  shift || true
  if [ -z "$node_bin" ]; then
    return 1
  fi
  exec "$node_bin" "$HOOK_SCRIPT" "$@"
}

if command -v node >/dev/null 2>&1; then
  run_with_node "$(command -v node)" "$@"
fi

if command -v node.exe >/dev/null 2>&1; then
  run_with_node "$(command -v node.exe)" "$@"
fi

to_posix_path() {
  local candidate="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$candidate" 2>/dev/null || printf '%s\n' "$candidate"
  else
    printf '%s\n' "$candidate"
  fi
}

try_windows_node_path() {
  local candidate="$1"
  shift || true
  if [ -z "$candidate" ]; then
    return 1
  fi

  local posix_candidate
  posix_candidate="$(to_posix_path "$candidate")"
  if [ -x "$posix_candidate" ]; then
    run_with_node "$posix_candidate" "$@"
  fi

  if [ -x "$candidate" ]; then
    run_with_node "$candidate" "$@"
  fi
}

PROGRAMFILES_X86="$(printenv 'ProgramFiles(x86)' 2>/dev/null || true)"

try_windows_node_path "${ProgramFiles:-}/nodejs/node.exe" "$@"
try_windows_node_path "${PROGRAMFILES:-}/nodejs/node.exe" "$@"
try_windows_node_path "${PROGRAMFILES_X86:-}/nodejs/node.exe" "$@"
try_windows_node_path "${NVM_SYMLINK:-}/node.exe" "$@"
try_windows_node_path "${NVM_HOME:-}/current/node.exe" "$@"
try_windows_node_path "${LOCALAPPDATA:-}/Programs/nodejs/node.exe" "$@"

# No Node.js runtime found anywhere. ClaudeVisual's hooks are an opt-in,
# low-latency signal only — fail open silently rather than print a warning
# that could be mistaken for a Claude Code error, and never block the session.
exit 0
