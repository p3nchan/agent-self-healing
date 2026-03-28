# Example: Custom Agent Systems

How to apply self-healing to any LLM agent system you've built.

## Prerequisites

Your system needs to expose two things:

1. **A way to list active sessions/tasks** — a file, database table, or API endpoint
2. **A way to send notifications** — webhook, CLI tool, or API call

Everything else is optional and can be added incrementally.

## Minimal Setup (Layer 1 Only)

If you just want basic monitoring, Layer 1 is enough:

```bash
# config.local.sh
AGENT_PROCESS_PATTERN="python.*agent_main\|node.*agent"
AGENT_HTTP_PORT="8080"
AGENT_LOG="/var/log/agent/agent.log"
HEARTBEAT_MARKER="AGENT_OK"  # whatever your agent logs periodically
NOTIFY_COMMAND=""  # empty = log only
```

This gives you:
- Process alive monitoring
- HTTP health check
- Restart storm detection
- Log activity check

**Cost: $0. No LLM. No external dependencies.**

## Adding Promise Detection

If your agent has user-facing conversations, add transcript logging.

### Transcript Format

The promise watchdog expects JSONL with this structure:

```jsonl
{"type":"message","timestamp":"ISO8601","message":{"role":"user","content":[{"type":"text","text":"user input"}]}}
{"type":"message","timestamp":"ISO8601","message":{"role":"assistant","content":[{"type":"text","text":"agent response"}]}}
```

### Session Store Format

The promise watchdog reads a JSON file mapping session IDs to metadata:

```json
{
  "session-abc": {
    "updatedAt": 1711987200000,
    "sessionFile": "/path/to/transcripts/session-abc.jsonl"
  },
  "session-def": {
    "updatedAt": 1711987300000,
    "sessionFile": "/path/to/transcripts/session-def.jsonl"
  }
}
```

### Customizing Session Filtering

Edit the `shouldInspectSession` function in `promise-watchdog.mjs` to match your session key format:

```javascript
function shouldInspectSession(sessionKey, entry) {
  // Skip system sessions
  if (sessionKey.startsWith("system:")) return false;
  if (sessionKey.startsWith("cron:")) return false;

  // Only inspect user-facing sessions
  if (!sessionKey.startsWith("user:")) return false;

  // Must be recent
  const updatedAt = parseOptionalNumber(entry.updatedAt);
  if (!updatedAt || nowMs - updatedAt > maxAgeMs) return false;

  return true;
}
```

### Adding Language Patterns

Add promise patterns for your users' language:

```javascript
const promisePattern = new RegExp([
  // English (default)
  "I('ll| will) (be back|reply|send)",
  "give me \\d+ minutes?",
  "be right back",

  // Japanese
  "ちょっと待って",
  "少々お待ち",
  "確認します",

  // Korean
  "잠시만요",
  "확인해보겠",

  // Spanish
  "un momento",
  "dame \\d+ minutos?",
  "ya vuelvo",
].join("|"), "i");
```

## Adding Layer 2 (LLM Heartbeat)

If your agent system has a way to:
1. List active sessions (API or file)
2. Send a message to a session
3. Kill a stuck session

Then you can run the LLM heartbeat. Customize the [heartbeat prompt template](../templates/heartbeat-prompt.md):

```markdown
## Allowed Tools

- list_sessions -- returns active sessions with last_active timestamp
- send_to_session -- sends a nudge message to a specific session
- kill_session -- terminates a stuck session
- send_notification -- sends an alert to the ops channel
```

Run it every 15 minutes with the cheapest model your API supports.

## Adding Checkpoints

For complex multi-step tasks, write checkpoint files before spawning workers:

```python
import json, time

def write_checkpoint(task_id, task_desc, steps):
    checkpoint = {
        "id": task_id,
        "task": task_desc,
        "type": "complex",
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "lastPing": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status": "running",
        "retryCount": 0,
        "pulseCount": 0,
        "steps": [{"name": s, "done": False} for s in steps]
    }
    path = f"healing/checkpoints/{task_id}.json"
    with open(path, "w") as f:
        json.dump(checkpoint, f, indent=2)

def update_step(task_id, step_index):
    path = f"healing/checkpoints/{task_id}.json"
    with open(path) as f:
        cp = json.load(f)
    cp["steps"][step_index]["done"] = True
    cp["lastPing"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    cp["currentStep"] = cp["steps"][step_index + 1]["name"] if step_index + 1 < len(cp["steps"]) else "Finalizing"
    with open(path, "w") as f:
        json.dump(cp, f, indent=2)

def clear_checkpoint(task_id):
    os.remove(f"healing/checkpoints/{task_id}.json")
```

## Incremental Adoption

You don't need everything on day one:

```
Week 1:  Layer 1 process watchdog only ($0, 5 minutes to set up)
Week 2:  Add promise detection (if you have user conversations)
Week 3:  Add Layer 2 heartbeat (if you run background agents)
Week 4:  Add checkpoints (for complex multi-step tasks)
Month 2: Add Layer 3 deep analysis (log patterns, checkpoint archaeology)
Month 3: Build your failure catalog from observed incidents
```

Each addition is independent. You can stop at any layer and still get value.
