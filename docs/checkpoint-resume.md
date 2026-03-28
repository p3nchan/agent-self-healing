# Checkpoint & Resume

## The Problem

AI agent sessions can die at any point -- context overflow, API timeout, process restart, network failure. When a session dies mid-task, two things go wrong:

1. **The user doesn't know** the task stopped
2. **The work is lost** because LLM context is gone

Checkpoints solve both problems: they persist task state outside the LLM's context window, enabling automatic detection and recovery.

## Checkpoint Schema

```json
{
  "id": "2026-03-12-data-analysis",
  "task": "Analyze Q1 revenue data and generate report",
  "type": "complex",
  "sessionKey": "agent:main:subagent:abc123",
  "threadId": "channel:ops-thread-42",
  "startedAt": "2026-03-12T05:00:00Z",
  "lastPing": "2026-03-12T05:03:00Z",
  "currentStep": "Generating charts from processed data",
  "contextUsage": 0.35,
  "status": "running",
  "needsHumanInput": false,
  "retryCount": 0,
  "pulseCount": 0,
  "steps": [
    { "name": "Fetch raw data", "done": true },
    { "name": "Clean and validate", "done": true },
    { "name": "Generate charts", "done": false },
    { "name": "Write summary", "done": false }
  ]
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier (date-slug format) |
| `task` | Yes | Human-readable task description |
| `type` | Yes | `simple` or `complex` |
| `sessionKey` | Yes | Which session is executing this task |
| `threadId` | Yes | Where to send notifications about this task |
| `startedAt` | Yes | ISO 8601 timestamp |
| `lastPing` | Yes | Auto-updated on each progress check |
| `currentStep` | No | What the agent is doing right now (for smart pulses) |
| `contextUsage` | No | 0-1, context window usage (for overflow warnings) |
| `status` | Yes | `running`, `completed`, or `failed` |
| `needsHumanInput` | No | True if the task is blocked waiting for user input |
| `retryCount` | Yes | How many times this task has been auto-resumed |
| `pulseCount` | Yes | How many liveness pulses have been sent |
| `steps` | No | Step list for complex tasks (enables partial recovery) |

## When to Write Checkpoints

- **Before spawning a sub-agent** -- The orchestrator writes the checkpoint, not the sub-agent
- **For any task estimated >30 seconds** -- Quick tasks don't need checkpoints
- **Sub-agents don't know checkpoints exist** -- They just do their work; the orchestrator manages lifecycle

## When to Clear Checkpoints

- **Task completed** → Delete the checkpoint file
- **Task failed** → Set `status: failed`, let the healing system handle it

## Liveness Pulse

Checkpoints enable "still working" notifications to keep users informed:

```
Task starts
  ├→ Orchestrator sends "Got it, working on it"
  ├→ Writes checkpoint
  └→ Heartbeat monitors pulse cadence

Every 5 minutes:
  ├→ Active checkpoint exists?
  │   ├→ Thread has recent output? → Skip (already visible)
  │   └→ Thread quiet >5 min? → Send pulse
  └→ No checkpoint → Skip

Pulse format:
  Mechanical:  "⏳ Still processing..."
  Smart:       "⏳ Working on: [currentStep from checkpoint]"
```

### Pulse Limits

- Maximum 10 pulses per task (prevent spam on very long tasks)
- No pulses during quiet hours (23:00-08:00 by default)
- Smart pulse (with step info) only when `currentStep` is populated

## Auto-Resume: Recovering from Crashes

When a session dies, its checkpoint becomes an orphan -- the checkpoint file exists but the session doesn't.

### Detection

Layer 3 (hourly) scans the checkpoint directory and cross-references with active sessions:

```
For each checkpoint file:
  Is the session still alive?
    YES → Normal, skip
    NO  → Orphan detected, evaluate for auto-resume
```

### Resume Conditions

| Condition | Action |
|-----------|--------|
| Age ≤ 1 hour AND retries < 2 AND not waiting for human | Auto-resume |
| Age > 1 hour | Archive checkpoint + notify user |
| `needsHumanInput: true` | Notify user only |
| `retryCount ≥ 2` | Notify user only (prevent infinite loops) |

### Resume Process

1. Read checkpoint: task description, current step, completed steps
2. Spawn new sub-agent with a prompt that includes:
   - Original task description
   - List of completed steps (from checkpoint)
   - "This is an auto-resumed task. Continue from where the previous session left off."
3. Increment `retryCount`
4. Notify user: "Detected interrupted task [name], auto-resuming."

### Important Caveat

**This is not true continuation.** When a session dies, its LLM context is gone forever. Auto-resume is re-execution guided by the step list, not a restore from checkpoint. Simple tasks are redone entirely. Complex tasks start from the first incomplete step.

## Thread-as-Checkpoint: The Fallback

What if the session dies before a checkpoint is written?

The conversation thread itself becomes the recovery source:

1. Read the thread history
2. Find the last non-assistant message (the user's original request)
3. Spawn a new session with that message + any partial results visible in the thread
4. Mark the recovery with a marker emoji so the system can count restarts

### Stateless Restart Counting

Instead of maintaining a counter file, count recovery markers in the thread:

```
Thread history:
  User: "Analyze this data"
  Agent: "Working on it..."
  🏥 Auto-recovered interrupted task
  Agent: "Resuming analysis..."
  🏥 Auto-recovered interrupted task
  Agent: "Third attempt..."
  → Count: 2 markers → Max reached, notify only, don't restart again
```

This is inherently crash-safe: the count survives any system restart because it lives in the messaging platform, not in a local file.

### Thread Replay Safety

| Limit | Value | Reason |
|-------|-------|--------|
| Max restarts per thread | 2 | Prevent infinite loops |
| Quiet hours | No restart | Don't restart tasks at 3 AM |
| No clear user intent | Notify only | Don't guess what the user wanted |

## Checkpoint vs Thread-as-Checkpoint

| | Checkpoint | Thread-as-Checkpoint |
|---|-----------|---------------------|
| Precision | High (step-level state) | Low (original request only) |
| When available | Orchestrator wrote one before crash | Always (thread always exists) |
| Recovery quality | Partial re-execution from last step | Full re-execution from scratch |
| Restart counting | `retryCount` in checkpoint | Marker emojis in thread |
| Use case | Complex, multi-step tasks | Simple tasks, or tasks that crashed early |

Both mechanisms exist because neither covers all cases. Checkpoint is preferred when available. Thread replay is the universal fallback.

## File Structure

```
healing/
  checkpoints/          # Active checkpoint files (.json)
    2026-03-12-data-analysis.json
    2026-03-12-report-generation.json
  logs/                 # Archived checkpoints (orphans, completed)
```

Keep checkpoint files in a dedicated directory. The healing system scans this directory on each hourly run.
