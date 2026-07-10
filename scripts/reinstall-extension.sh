#!/usr/bin/env bash
# Builds a production VSIX and force-installs it into the user's default VS Code
# profile. Intended for the "deploy a real build to my daily-driver VS Code"
# loop; for active source iteration use the F5 Extension Development Host
# instead (no packaging step, just Cmd+R to reload).
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v code >/dev/null 2>&1; then
  echo "error: 'code' CLI not found in PATH." >&2
  echo "Fix: in VS Code, Cmd+Shift+P > 'Shell Command: Install code command in PATH'," >&2
  echo "or symlink the CLI manually, e.g.:" >&2
  echo "  ln -sf \"/path/to/Visual Studio Code.app/Contents/Resources/app/bin/code\" ~/.local/bin/code" >&2
  exit 1
fi

npm run package

vsix="$(ls -t ./*.vsix | head -1)"
if [ -z "${vsix}" ]; then
  echo "error: npm run package did not produce a .vsix" >&2
  exit 1
fi

code --install-extension "${vsix}" --force

if command -v osascript >/dev/null 2>&1; then
  osascript -e 'display notification "Reload Window (Cmd+Shift+P) to activate the new build." with title "ClaudeVisual reinstalled" sound name "Glass"' >/dev/null 2>&1 || true
fi

echo "Installed ${vsix}."
echo "Reload the VS Code window to activate it: Cmd+Shift+P > Developer: Reload Window."
