#!/bin/bash
# process-watchdog.sh — Layer 1: Shell-based agent health monitor
#
# Checks:
#   1. Agent process alive
#   2. Agent HTTP responding
#   3. Heartbeat (Layer 2) recently active
#   4. Restart storm detection
#   5. Promise detection (via promise-watchdog.mjs)
#
# Run via cron every 5 minutes ($0, so run often):
#   */5 * * * * /bin/bash /path/to/process-watchdog.sh
#
# Exit codes:
#   0 = all clear
#   1 = issues detected (alerts sent)

set -uo pipefail

# ─── Load config ─────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/config.local.sh" ]; then
  source "${SCRIPT_DIR}/config.local.sh"
else
  source "${SCRIPT_DIR}/config.sh"
fi

# ─── Logging ─────────────────────────────────────────────────────
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$WATCHDOG_LOG"
}

# ─── Notification with deduplication ─────────────────────────────
notify() {
  local body="$1"
  local now_epoch signature last_signature="" last_ts=0
  now_epoch="$(date '+%s')"
  signature="$(printf '%s' "$body" | shasum | awk '{print $1}')"

  # Check for duplicate within cooldown window
  if [ -f "$ALERT_STATE" ]; then
    last_signature="$(awk 'NR==1 {print $1}' "$ALERT_STATE" 2>/dev/null || true)"
    last_ts="$(awk 'NR==1 {print $2}' "$ALERT_STATE" 2>/dev/null || echo 0)"
  fi

  if [ "$signature" = "$last_signature" ] && [ $((now_epoch - last_ts)) -lt "$ALERT_COOLDOWN" ]; then
    log "ALERT_SKIP: duplicate within ${ALERT_COOLDOWN}s cooldown"
    return 0
  fi

  # Dry run mode
  if [ "$DRY_RUN" = "1" ]; then
    log "ALERT_DRY_RUN: $body"
    return 0
  fi

  # Send notification
  if [ -n "$NOTIFY_COMMAND" ]; then
    mkdir -p "$(dirname "$ALERT_STATE")"
    if eval "$NOTIFY_COMMAND" '"$body"' >/dev/null 2>&1; then
      printf '%s %s\n' "$signature" "$now_epoch" > "$ALERT_STATE"
      log "ALERT_SENT"
      return 0
    else
      log "ALERT_FAILED: notification command returned error"
      return 1
    fi
  else
    log "ALERT_LOG_ONLY: $body"
    return 0
  fi
}

# ─── Trim watchdog log if too long ───────────────────────────────
if [ -f "$WATCHDOG_LOG" ] && [ "$(wc -l < "$WATCHDOG_LOG" 2>/dev/null || echo 0)" -gt "$WATCHDOG_MAX_LOG_LINES" ]; then
  tail -n 100 "$WATCHDOG_LOG" > "${WATCHDOG_LOG}.tmp" && mv "${WATCHDOG_LOG}.tmp" "$WATCHDOG_LOG"
fi

ISSUES=()

# ─── Check 1: Agent process alive ───────────────────────────────
AGENT_PID=$(pgrep -f "$AGENT_PROCESS_PATTERN" -u "$(id -u)" | head -1)
if [ -z "$AGENT_PID" ]; then
  ISSUES+=("PROCESS_DOWN: No agent process matching '${AGENT_PROCESS_PATTERN}'")
else
  # ─── Check 2: HTTP health ──────────────────────────────────────
  if ! curl -sf --max-time 5 "$AGENT_HTTP_URL" > /dev/null 2>&1; then
    ISSUES+=("HTTP_FAIL: Process alive (PID ${AGENT_PID}) but HTTP not responding at ${AGENT_HTTP_URL}")
  fi
fi

# ─── Check 3: Heartbeat activity ────────────────────────────────
if [ -f "$AGENT_LOG" ]; then
  RECENT_HB=$(tail -500 "$AGENT_LOG" 2>/dev/null | grep -c "$HEARTBEAT_MARKER" || echo "0")
  if [ "$RECENT_HB" -eq 0 ]; then
    ISSUES+=("HEARTBEAT_SILENT: No '${HEARTBEAT_MARKER}' found in recent log")
  fi
fi

# ─── Check 4: Restart storm ─────────────────────────────────────
if [ -f "$AGENT_LOG" ]; then
  RESTART_COUNT=$(tail -1000 "$AGENT_LOG" 2>/dev/null | grep -cE "$RESTART_SIGNAL_PATTERN" || echo "0")
  if [ "$RESTART_COUNT" -gt "$RESTART_STORM_THRESHOLD" ]; then
    ISSUES+=("RESTART_STORM: ${RESTART_COUNT} restart signals in recent log (threshold: ${RESTART_STORM_THRESHOLD})")
  fi
fi

# ─── Report infrastructure issues ───────────────────────────────
if [ ${#ISSUES[@]} -eq 0 ]; then
  log "OK"
else
  for issue in "${ISSUES[@]}"; do
    log "WARN: $issue"
  done
  notify "Agent watchdog detected issues:\n$(printf -- '- %s\n' "${ISSUES[@]}")"
fi

# ─── Check 5: Promise detection (Node.js) ───────────────────────
SESSION_EXIT=0
if [ -f "$PROMISE_WATCHDOG" ] && [ -n "$NODE_BIN" ]; then
  export SESSION_STORE
  export SESSION_WATCHDOG_DRY_RUN="$DRY_RUN"
  export SESSION_WATCHDOG_REPLY_MINUTES="$PROMISE_REPLY_MINUTES"
  export SESSION_WATCHDOG_PROMISE_MINUTES="$PROMISE_PROMISE_MINUTES"
  export SESSION_WATCHDOG_MAX_AGE_MINUTES="$PROMISE_MAX_AGE_MINUTES"
  export SESSION_WATCHDOG_REPEAT_MINUTES="$PROMISE_REPEAT_MINUTES"

  SESSION_OUTPUT="$("$NODE_BIN" "$PROMISE_WATCHDOG" 2>&1)"
  SESSION_EXIT=$?
  if [ -n "$SESSION_OUTPUT" ]; then
    log "$SESSION_OUTPUT"
  fi
  if [ $SESSION_EXIT -ne 0 ]; then
    log "WARN: promise-watchdog exited with status $SESSION_EXIT"
  fi
elif [ ! -f "$PROMISE_WATCHDOG" ]; then
  log "INFO: promise-watchdog not found at $PROMISE_WATCHDOG (skipping)"
elif [ -z "$NODE_BIN" ]; then
  log "INFO: Node.js not found (promise-watchdog skipped)"
fi

# ─── Final exit code ─────────────────────────────────────────────
if [ ${#ISSUES[@]} -eq 0 ] && [ "$SESSION_EXIT" -eq 0 ]; then
  exit 0
fi

exit 1
