#!/bin/sh
set -eu

# Resets the agent's durable session state whenever the compiled agent changes.
#
# eve keeps conversation sessions (and their pinned instructions) across
# deployments, so authored instruction/model changes would otherwise not take
# effect for users with an existing session. This entrypoint fingerprints the
# agent source baked into the image; when it differs from the last run, the
# session store is cleared so the next message starts a fresh session.

AGENT_DIR="/app/agent"
STATE_DIR="${EVE_STATE_DIR:-/app/.eve/.workflow-data}"
STORED_ID_FILE="$STATE_DIR/.build-id"

compute_build_id() {
  find "$AGENT_DIR" -type f 2>/dev/null \
    | LC_ALL=C sort \
    | xargs sha256sum 2>/dev/null \
    | sha256sum \
    | cut -d' ' -f1
}

current_id="$(compute_build_id || true)"

if [ -n "$current_id" ]; then
  stored_id=""
  if [ -f "$STORED_ID_FILE" ]; then
    stored_id="$(cat "$STORED_ID_FILE" 2>/dev/null || true)"
  fi

  if [ "$current_id" != "$stored_id" ]; then
    if [ -n "$stored_id" ]; then
      echo "[entrypoint] Agent code changed ($stored_id -> $current_id); resetting session state."
    else
      echo "[entrypoint] First run for build $current_id; initializing session state."
    fi
    rm -rf \
      "$STATE_DIR/events" \
      "$STATE_DIR/hooks" \
      "$STATE_DIR/runs" \
      "$STATE_DIR/steps" \
      "$STATE_DIR/streams" \
      "$STATE_DIR/waits" \
      "$STATE_DIR/.locks"
    mkdir -p "$STATE_DIR"
    printf '%s' "$current_id" > "$STORED_ID_FILE"
  fi
fi

exec "$@"
