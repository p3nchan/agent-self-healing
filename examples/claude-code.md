# Example: Claude Code with Subagents

How to apply self-healing to a Claude Code setup with multiple subagents.

## Architecture Mapping

```
Your Setup                          Self-Healing Layer
────────────────────────────────    ─────────────────────────
Claude Code main session            Layer 0: built-in
Claude Code subagents               Layer 2: heartbeat monitors these
Gateway/proxy process               Layer 1: process-watchdog.sh
Cron jobs (scheduled tasks)         Layer 1: checks heartbeat is alive
```

## Layer 1 Setup

### Process Watchdog

Configure `config.local.sh`:

```bash
# Match your Claude Code gateway or proxy process
AGENT_PROCESS_PATTERN="openclaw.*gateway\|claude-code.*serve"
AGENT_HTTP_PORT="18789"

# Log file where your gateway writes
AGENT_LOG="$HOME/.openclaw/logs/gateway.log"

# Where the watchdog writes its own log
WATCHDOG_LOG="$HOME/.openclaw/logs/watchdog.log"

# Session store (where Claude Code tracks active sessions)
SESSION_STORE="$HOME/.openclaw/agents/main/sessions/sessions.json"

# Notification (example: Discord webhook)
NOTIFY_COMMAND="curl -s -X POST -H 'Content-Type: application/json' -d '{\"content\": \$1}' https://discord.com/api/webhooks/YOUR_WEBHOOK"
```

Add to crontab:

```bash
*/10 * * * * /bin/bash /path/to/agent-self-healing/scripts/process-watchdog.sh
```

### Promise Watchdog

The promise watchdog reads Claude Code's JSONL session files. The default transcript format matches Claude Code's output:

```jsonl
{"type":"message","timestamp":"...","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
{"type":"message","timestamp":"...","message":{"role":"assistant","content":[{"type":"text","text":"..."}]}}
```

No adapter needed -- it works out of the box.

## Layer 2 Setup

### Heartbeat Prompt

If your platform supports system-level heartbeats, use the [heartbeat prompt template](../templates/heartbeat-prompt.md) with these tool mappings:

```
[SESSION_LIST_TOOL]  → sessions_list
[SESSION_SEND_TOOL]  → sessions_send
[AGENT_LIST_TOOL]    → subagents list
[AGENT_KILL_TOOL]    → subagents kill
[NOTIFY_TOOL]        → message (Discord/Telegram)
```

Set to run every 15 minutes with a cheap model (gemini-flash recommended).

### Heartbeat Configuration

```json
{
  "every": "15m",
  "activeHours": { "start": "08:00", "end": "23:30" },
  "model": "gemini-flash",
  "lightContext": true
}
```

## Layer 3 Setup

Layer 3 (hourly deep analysis) maps to existing maintenance automation:

- **Checkpoint management**: Scan `healing/checkpoints/` for orphans
- **Context guardian**: Check subagent context usage via session metadata
- **Log analysis**: Grep error logs for patterns from the failure catalog

If you use [auto-optimization](https://github.com/p3nchan/auto-optimization), the hourly tier already handles sentinel checks and log scanning. Layer 3 of self-healing adds checkpoint management on top.

## Checkpoint Integration

When your orchestrator spawns a subagent for a complex task:

1. Write a checkpoint to `healing/checkpoints/<task-id>.json`
2. Spawn the subagent (it doesn't know about checkpoints)
3. On completion: delete the checkpoint
4. On failure: set `status: failed`

The heartbeat and hourly analysis will handle orphaned checkpoints automatically.

## Cost Profile

```
Layer 1 (cron @5m, shell + Node.js):   $0/month
Layer 2 (gemini-flash @15m, 96/day):   $0/month (free tier)
Layer 3 (hourly, mostly shell):        ~$0.10/month
```
