# Example: Chat Bots (Discord / Telegram / Slack)

How to apply self-healing to LLM-powered chat bots.

## The Problem

Chat bots have a unique failure mode: the user sends a message and the bot goes silent. The bot process is alive, the API is reachable, but the response generation stalled or errored silently.

Users can't tell the difference between "thinking for 30 seconds" and "crashed." They wait, then ask again, then give up.

## Architecture Mapping

```
Your Setup                          Self-Healing Layer
────────────────────────────────    ─────────────────────────
Bot process (node/python/etc)       Layer 0 + Layer 1: process alive + HTTP
Message handler                     Layer 1: promise watchdog
Background tasks / workers          Layer 2: session liveness
Bot platform (Discord.js, etc)      Layer 0: reconnect on disconnect
```

## Layer 1: Process Watchdog

Configure `config.local.sh`:

```bash
AGENT_PROCESS_PATTERN="node.*my-bot\|python.*bot.py"
AGENT_HTTP_PORT="3000"
AGENT_LOG="/var/log/my-bot/bot.log"
WATCHDOG_LOG="/var/log/my-bot/watchdog.log"

# Discord webhook notification
NOTIFY_COMMAND="curl -s -X POST -H 'Content-Type: application/json' -d"
NOTIFY_TARGET="https://discord.com/api/webhooks/YOUR_WEBHOOK_URL"
```

### Custom Notification Handler

For Discord webhooks, the notification command needs to format JSON:

```bash
# In config.local.sh
notify_discord() {
  local msg="$1"
  curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "{\"content\": $(printf '%s' "$msg" | jq -Rs .)}" \
    "$NOTIFY_TARGET"
}
export -f notify_discord
NOTIFY_COMMAND="notify_discord"
```

For Telegram:

```bash
NOTIFY_COMMAND="curl -s 'https://api.telegram.org/bot${BOT_TOKEN}/sendMessage' -d chat_id=${CHAT_ID} -d text="
```

## Layer 1.5: Promise Watchdog Adapter

The promise watchdog needs a transcript in JSONL format. If your bot doesn't write JSONL transcripts, you have two options:

### Option A: Write JSONL from your bot

Add logging to your message handler:

```javascript
// After receiving a user message
fs.appendFileSync(transcriptPath, JSON.stringify({
  type: "message",
  timestamp: new Date().toISOString(),
  message: { role: "user", content: [{ type: "text", text: userMessage }] }
}) + "\n");

// After sending a bot response
fs.appendFileSync(transcriptPath, JSON.stringify({
  type: "message",
  timestamp: new Date().toISOString(),
  message: { role: "assistant", content: [{ type: "text", text: botResponse }] }
}) + "\n");
```

### Option B: Skip promise detection

If your bot architecture doesn't support transcript logging, you can still use Layer 1 for process monitoring and Layer 2 for session management. Set `PROMISE_WATCHDOG=""` in config to disable.

## Layer 2: LLM Heartbeat

For bots that spawn background workers or long-running tasks, Layer 2 monitors those workers:

1. Maintain a `sessions.json` that tracks active workers
2. Run the heartbeat prompt every 15 minutes
3. Workers that haven't reported progress in 20 minutes get killed

### Simple Worker Tracking

```javascript
// When starting a background task
const taskId = `task-${Date.now()}`;
sessions[taskId] = {
  updatedAt: Date.now(),
  task: "Processing user request",
  sessionFile: `/path/to/transcripts/${taskId}.jsonl`
};
writeJsonSync("sessions.json", sessions);

// Periodically update while working
sessions[taskId].updatedAt = Date.now();

// On completion
delete sessions[taskId];
```

## What You Get

- **Process crashes**: Detected in <5 minutes, alert sent
- **Silent stalls**: User waits >6 minutes for a reply → alert sent
- **Broken promises**: Bot says "one moment" and never follows up → detected in 7 minutes
- **Worker zombies**: Background tasks stalled >30 minutes → killed automatically
- **Restart storms**: Bot crash-looping → detected after 4th restart
