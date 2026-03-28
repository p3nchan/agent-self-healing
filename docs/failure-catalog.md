# Failure Catalog

Real failure patterns from production. Each entry includes: what to detect, what the user sees, what to do automatically, and when to notify.

This catalog was built incrementally over months. Start with the common ones and add entries as you observe new patterns.

---

## Format

```markdown
### ISSUE-ID
- **Detect**: Log pattern or condition to match
- **Symptom**: What the user or operator sees
- **Auto-action**: What the system does automatically (or "notify only")
- **Notify**: Message template (or "none" for self-healing issues)
```

---

## Category 1: Tool Hallucination

LLM monitors invoke tools that don't exist or aren't available in their context.

### TOOL-MISFIRE

- **Detect**: `tool failed` / `command not found` / `Missing required parameter` in heartbeat session logs
- **Symptom**: Error log volume spikes. Signal-to-noise ratio drops. Real issues get buried.
- **Auto-action**: Log only. Root cause fix: use [prohibition-first prompts](prohibition-first-prompts.md)
- **Notify**: None (self-healing via prompt design)
- **Examples seen**: LLM tried `canvas` (no canvas available), `exec rss-tool` (doesn't exist), `edit` without required parameters, Slack Block Kit format for Discord messages

### CROSS-PLATFORM-ID

- **Detect**: Platform A's identifiers used in Platform B's API calls (e.g., Discord channel ID in a Telegram `chat_id` field)
- **Symptom**: "Chat not found" errors
- **Auto-action**: Log only. Root cause fix: constrain channel-specific operations in the prompt
- **Notify**: None (self-healing via prompt design)

### DANGEROUS-COMMAND-EXECUTION

- **Detect**: Agent executes a system command it read from script output (e.g., `gateway restart`)
- **Symptom**: Unscheduled system restart, interrupted sessions
- **Auto-action**: Trigger orphan detection (see ORPHAN-CHECKPOINT)
- **Notify**: "System received unscheduled restart signal. Checking task status..."
- **Prevention**: 4-layer defense:
  1. Script output: Don't write actionable commands ("restart X"). Write passive statements ("changes take effect next cycle")
  2. Agent prompt: Prohibit system operations
  3. Monitor prompt: Prohibit system operations
  4. Watchdog prompt: Prohibit system operations

---

## Category 2: Session Stalls

The agent is process-alive but semantically stuck.

### ZOMBIE-SUBAGENT

- **Detect**: Sub-agent `status=running`, `last_active` > 30 minutes
- **Symptom**: Task appears in progress but nothing is happening
- **Auto-action**: `kill` the sub-agent + clean up any checkpoint
- **Notify**: "Terminated stuck agent [name] (inactive for 30+ minutes)"

### ORPHAN-CHECKPOINT

- **Detect**: Checkpoint file exists but corresponding session is not in the active session list
- **Symptom**: User may not know their task was interrupted
- **Auto-action**: If conditions met (see [Checkpoint & Resume](checkpoint-resume.md)), auto-resume. Otherwise archive + notify
- **Notify**: "Detected interrupted task [name]. Auto-resuming." or "Interrupted task [name] needs manual restart."

### PENDING-REPLY

- **Detect**: Last transcript message is from user, no assistant response for >6 minutes
- **Symptom**: User is waiting for a response that isn't coming
- **Auto-action**: Notify ops channel with diagnostic context
- **Notify**: "Session stalled for [N] minutes. Last user message: [preview]"

### BROKEN-PROMISE

- **Detect**: Last assistant message matches promise pattern, unfulfilled for >7 minutes
- **Symptom**: Agent said it would do something and hasn't
- **Auto-action**: Notify ops channel with diagnostic context
- **Notify**: "Session stalled for [N] minutes. Last promise: [preview]"

---

## Category 3: Context & Resources

The agent's working environment degrades.

### CONTEXT-OVERFLOW

- **Detect**: Session context usage > 80%
- **Symptom**: Response quality degrades, eventual crash
- **Auto-action**: Notify only (don't auto-compact -- could interrupt work)
- **Notify**: "Session [name] context at [XX]%. Recommend compact or new session."

### DISK-USAGE

- **Detect**: Workspace directory exceeds size threshold
- **Symptom**: Slow operations, potential write failures
- **Auto-action**: Notify only
- **Notify**: "Workspace at [XX] GB. Review temp files and logs."

---

## Category 4: Restart & Recovery

The system restarts, either planned or unplanned.

### RESTART-STORM

- **Detect**: >4 restart signals (SIGTERM/SIGUSR1) in recent log (1 hour)
- **Symptom**: Sessions repeatedly interrupted, tasks never complete
- **Auto-action**: Alert with restart count
- **Notify**: "Restart storm detected: [N] restarts in the last hour"

### FORCED-RESTART

- **Detect**: Config change followed by restart timeout and force restart
- **Symptom**: In-progress sessions interrupted
- **Auto-action**: Trigger orphan checkpoint scan
- **Notify**: "Forced restart (config change couldn't complete gracefully). Checking tasks..."

### AUTH-TOKEN-ROTATION

- **Detect**: Auth token change triggers automatic restart
- **Symptom**: Periodic unscheduled restarts
- **Auto-action**: Log only (platform behavior)
- **Notify**: Only if >3 consecutive: "Auth token keeps rotating, causing repeated restarts"

### BARE-SIGTERM

- **Detect**: SIGTERM received without preceding config change (within 5 minutes)
- **Symptom**: Unexplained restart
- **Auto-action**: Trigger orphan checkpoint scan
- **Notify**: "Unexpected SIGTERM received. Checking task status..."

---

## Category 5: Infrastructure

External service issues that affect agent operation.

### API-OVERLOADED

- **Detect**: 503 / "model is overloaded" from LLM provider
- **Symptom**: Agent requests fail, retry logic kicks in
- **Auto-action**: Log only (provider-side, will auto-recover)
- **Notify**: Only if >5 consecutive: "LLM API persistently overloaded"

### RATE-LIMITED

- **Detect**: 429 responses from any API
- **Symptom**: Search/fetch operations fail
- **Auto-action**: Log only
- **Notify**: None (self-healing via retry/backoff)

### DNS-ROUTING

- **Detect**: Polling stalls, IPv4/IPv6 routing failures
- **Symptom**: Message polling stops, agent appears offline
- **Auto-action**: Log only (may need manual network config)
- **Notify**: If persistent: "Network routing issue detected. Check DNS/IP config."

### HEARTBEAT-SILENT

- **Detect**: No `HEARTBEAT_OK` in log for >15 minutes
- **Symptom**: The monitor itself has failed
- **Auto-action**: Alert (this is Layer 1 monitoring Layer 2)
- **Notify**: "Heartbeat monitor has been silent for [N] minutes"

---

## Category 6: Downstream Effects

Secondary failures caused by primary issues.

### WEBHOOK-EXPIRED

- **Detect**: "Invalid Webhook Token" / "Unknown Channel" in response to delayed replies
- **Symptom**: Bot fails to respond to slash commands
- **Auto-action**: Log only (root cause: slow response, not webhook issue)
- **Notify**: None (fix the upstream latency)

### INTERACTION-TIMEOUT

- **Detect**: Interaction listener took >10 seconds
- **Symptom**: User sees loading spinner for too long
- **Auto-action**: Log only
- **Notify**: Only if >30 seconds: "Interaction response delayed [N]s"

---

## Building Your Own Catalog

### Start Small

Don't try to catalog everything on day one. Start with:
1. ZOMBIE-SUBAGENT (most common)
2. PENDING-REPLY (most user-visible)
3. HEARTBEAT-SILENT (most dangerous if missed)

### Add From Observation

When something fails:
1. Document the log pattern
2. Document what the user saw
3. Decide: auto-fix, auto-notify, or just log?
4. Add to catalog
5. Update monitoring scripts to detect it

### Review Monthly

Some patterns become obsolete as your system evolves. Remove entries that haven't matched in 3 months. Add entries for new failure modes.

### Threshold Tuning

Start with generous thresholds (longer timeouts, higher counts before alerting). Tighten as you understand your false positive rate. A monitoring system that cries wolf is worse than no monitoring at all.
