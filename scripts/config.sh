#!/bin/bash
# config.sh — Shared configuration for self-healing scripts
#
# Copy this file to config.local.sh and customize.
# The watchdog scripts source config.local.sh if it exists, otherwise this file.

# ─── Agent Process ───────────────────────────────────────────────
# Pattern to match your agent process (used with pgrep -f)
AGENT_PROCESS_PATTERN="${AGENT_PROCESS_PATTERN:-your-agent.*--port}"

# HTTP health check endpoint
AGENT_HTTP_PORT="${AGENT_HTTP_PORT:-8080}"
AGENT_HTTP_URL="${AGENT_HTTP_URL:-http://127.0.0.1:${AGENT_HTTP_PORT}/}"

# ─── Paths ───────────────────────────────────────────────────────
# Workspace root (where your agent's files live)
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$HOME/.agent-workspace}"

# Log files
AGENT_LOG="${AGENT_LOG:-${WORKSPACE_ROOT}/logs/agent.log}"
WATCHDOG_LOG="${WATCHDOG_LOG:-${WORKSPACE_ROOT}/logs/watchdog.log}"
WATCHDOG_MAX_LOG_LINES="${WATCHDOG_MAX_LOG_LINES:-300}"

# Promise watchdog (Node.js)
PROMISE_WATCHDOG="${PROMISE_WATCHDOG:-$(dirname "$0")/promise-watchdog.mjs}"
SESSION_STORE="${SESSION_STORE:-${WORKSPACE_ROOT}/sessions/sessions.json}"

# Alert deduplication state file
ALERT_STATE="${ALERT_STATE:-${WORKSPACE_ROOT}/tmp/watchdog-alert-state}"

# ─── Notifications ───────────────────────────────────────────────
# Command to send notifications. Must accept a message string as the last argument.
# Examples:
#   Discord webhook:  "curl -s -X POST -H 'Content-Type: application/json' -d"
#   Slack webhook:    "curl -s -X POST -H 'Content-Type: application/json' -d"
#   Telegram:         "curl -s https://api.telegram.org/bot${BOT_TOKEN}/sendMessage -d chat_id=${CHAT_ID} -d text="
#   Custom CLI:       "your-cli notify send --message"
#
# Set to empty string to disable notifications (log only).
NOTIFY_COMMAND="${NOTIFY_COMMAND:-}"

# Notification target (platform-specific identifier)
# Only used if your NOTIFY_COMMAND needs a target parameter
NOTIFY_TARGET="${NOTIFY_TARGET:-}"

# ─── Thresholds ──────────────────────────────────────────────────
# Heartbeat: how recently should the heartbeat have fired? (seconds)
HEARTBEAT_MAX_SILENCE="${HEARTBEAT_MAX_SILENCE:-1200}"  # 20 minutes (L2 runs every 15m)

# Heartbeat marker in log (what the heartbeat outputs when all is well)
HEARTBEAT_MARKER="${HEARTBEAT_MARKER:-HEARTBEAT_OK}"

# Restart storm: how many restarts in recent log = suspicious
RESTART_STORM_THRESHOLD="${RESTART_STORM_THRESHOLD:-4}"

# Restart signal patterns in log
RESTART_SIGNAL_PATTERN="${RESTART_SIGNAL_PATTERN:-signal SIGTERM received|signal SIGUSR1 received}"

# Alert deduplication cooldown (seconds)
ALERT_COOLDOWN="${ALERT_COOLDOWN:-1800}"  # 30 minutes

# ─── Promise Watchdog ────────────────────────────────────────────
# How long before flagging an unanswered user message (minutes)
PROMISE_REPLY_MINUTES="${SESSION_WATCHDOG_REPLY_MINUTES:-6}"

# How long before flagging an unfulfilled promise (minutes)
PROMISE_PROMISE_MINUTES="${SESSION_WATCHDOG_PROMISE_MINUTES:-7}"

# Ignore sessions older than this (minutes)
PROMISE_MAX_AGE_MINUTES="${SESSION_WATCHDOG_MAX_AGE_MINUTES:-45}"

# Dedup cooldown (minutes)
PROMISE_REPEAT_MINUTES="${SESSION_WATCHDOG_REPEAT_MINUTES:-20}"

# ─── Advanced ────────────────────────────────────────────────────
# Dry run mode (1 = log alerts but don't send)
DRY_RUN="${WATCHDOG_DRY_RUN:-0}"

# Node.js binary path (auto-detected if not set)
NODE_BIN="${NODE_BIN:-$(command -v node 2>/dev/null || echo "")}"
