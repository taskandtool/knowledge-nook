#!/usr/bin/env bash
# Knowledge Nook setup. Task & Tool runs this in ~/app after the repository is cloned onto the
# machine, and again whenever the machine is replaced. Safe to re-run any time:
#
#     bash ~/app/.taskandtool/setup.sh
#
# The owner's working knowledge (sources/, raw/, distilled/, index/, content/) comes back
# from backups, not from here. tt-crawl and its browsers are after-setup.sh's.
set -euo pipefail

APP="$(pwd)"
echo "== knowledge-nook: setup in $APP"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "node and npm are required (Node 20 or newer); install them and re-run" >&2
  exit 1
fi
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 20 ]; then
  echo "Node $(node --version) found; the site needs Node 20 or newer" >&2
  exit 1
fi

if [ ! -d .git ]; then
  git init -q
fi
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  git add -A
  git -c user.name="${GIT_AUTHOR_NAME:-$(git config user.name || echo 'Task & Tool')}" \
      -c user.email="${GIT_AUTHOR_EMAIL:-$(git config user.email || echo 'knowledge-nook@taskandtool.app')}" \
      commit -q -m "Knowledge Nook Starter App" && echo "== first commit made"
fi

echo "== npm install"
npm ci --no-audit --no-fund --loglevel=error || npm install --no-audit --no-fund --loglevel=error
echo "== building the CSS"
npm run --silent css

# The web service, which the manifest's `ready` check looks for: a failure here fails the setup.
if [ -f "$HOME/tools/taskandtool.py" ]; then
  echo "== serving dev (npm run dev on port 3000)"
  python3 "$HOME/tools/taskandtool.py" serve "npm run dev" --port 3000
fi

echo "== knowledge-nook setup done. Next: dev answers at localhost:3000; add a channel in chat"
