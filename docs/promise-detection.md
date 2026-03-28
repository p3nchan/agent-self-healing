# Promise Detection

## The Problem

Traditional monitoring asks: "Is the process running?" But AI agents have a failure mode that processes don't: **they make promises and then go silent.**

```
User:   "Can you analyze this data?"
Agent:  "Sure, give me 5 minutes and I'll have the results."
... 20 minutes of silence ...
```

The process is alive. The HTTP endpoint is healthy. The heartbeat says everything is fine. But the user is waiting for something that will never come.

## The Pattern

Read the agent's conversation transcript. Apply pattern matching to detect two conditions:

1. **Pending reply**: The last message is from the user, and the agent hasn't responded within a threshold (default: 6 minutes)
2. **Broken promise**: The agent's last message contains a commitment phrase, and it's been unfulfilled beyond a threshold (default: 7 minutes)

## Promise Patterns

The promise detector uses regex to identify commitment language:

```javascript
const promisePattern = new RegExp([
  // "Give me a few minutes"
  "give me \\d+ minutes?",
  "be right back",
  "let me (check|pull|look|find)",
  "I('ll| will) (be back|reply|send|post|follow up)",

  // Add patterns for your language
  // Chinese examples:
  // "再給我", "幾分鐘", "稍等", "等我", "等一下",
  // "我現在就去", "10 分鐘內", "稍後回覆"
].join("|"), "i");
```

This isn't trying to be a general NLP system. It catches the most common forms of agent promises with high precision and near-zero false positives.

## Transcript Structure

The watchdog reads JSONL transcript files with this structure:

```jsonl
{"type": "message", "timestamp": "2026-03-12T10:00:00Z", "message": {"role": "user", "content": [{"type": "text", "text": "Analyze this data"}]}}
{"type": "message", "timestamp": "2026-03-12T10:00:30Z", "message": {"role": "assistant", "content": [{"type": "text", "text": "Sure, give me 5 minutes."}]}}
```

The watchdog extracts the last user message and last assistant message, then applies its checks.

## Decision Logic

```
Read transcript
  │
  ├─ Last message is from user?
  │   └─ Age > reply threshold (6 min)?
  │       └─ YES → Notify: "pending reply"
  │
  └─ Last message is from assistant?
      └─ Matches promise pattern?
          └─ Age > promise threshold (7 min)?
              └─ YES → Notify: "broken promise"
```

## Diagnostic Context

When a stall is detected, the notification includes diagnostic context to help determine the cause:

```
Session stalled for 12 minutes.
Last promise: "Give me 5 minutes, I'll send the results."
Status:
- Gateway restarted 1 time during this window
- Config reload failed 0 times
- 0 active sub-agents visible
```

This helps distinguish between:
- **Agent crashed** (gateway restart during window, no sub-agents)
- **Agent is busy** (sub-agent is active, doing work)
- **Agent forgot** (no restarts, no sub-agents, just silence)

## Deduplication

The same notification is suppressed for 20 minutes using a signature hash:

```
signature = hash(reason + subjectTimestamp + restartCount + incidentCount + auditStatus + subagentPresence)
```

This means:
- Same stall, same context → suppressed
- Same stall, but a gateway restart happened → new notification (context changed)
- Same stall, but a sub-agent appeared → new notification (situation evolved)

## Thresholds

All thresholds are configurable via environment variables:

| Setting | Default | Description |
|---------|---------|-------------|
| Reply threshold | 6 min | Time before flagging an unanswered user message |
| Promise threshold | 7 min | Time before flagging an unfulfilled promise |
| Max session age | 45 min | Ignore sessions older than this (likely abandoned) |
| Repeat cooldown | 20 min | Don't re-notify for the same stall within this window |
| Sub-agent window | 15 min | Consider a sub-agent "active" if updated within this window |

### Why different thresholds?

- **Reply threshold (6 min)** is shorter because the user is actively waiting
- **Promise threshold (7 min)** is slightly longer because the agent explicitly asked for time
- **Max age (45 min)** prevents alerts on legitimately long-running sessions that the user has walked away from

## Text Sanitization

Before matching, transcript text is cleaned of platform-specific noise:

- Reply-to metadata
- Conversation info blocks
- Queued message markers
- Media attachment markers
- System messages

This prevents false matches on metadata that happens to contain promise-like phrases.

## Limitations

1. **Regex, not NLP** -- The pattern matching catches common phrasings but not all. "I need to think about this and get back to you" won't match. This is intentional: high precision > high recall for monitoring.

2. **Last message only** -- The watchdog only examines the last user and last assistant messages. If the agent made a promise 10 messages ago and has been doing other work since, it won't be flagged. The transcript summary is deliberately shallow to stay fast.

3. **Language coverage** -- The default patterns cover English and Chinese. Add patterns for other languages as needed.

4. **Platform-specific transcripts** -- The JSONL format and message structure vary by platform. The watchdog needs a `readTranscript` adapter for your specific agent platform.

## Adding to Your System

1. **Identify your transcript format** -- Where does your agent store conversation history? What's the message structure?

2. **Write a readTranscript adapter** -- Extract (timestamp, role, text) from your format

3. **Customize promise patterns** -- Add phrases your agents commonly use. Monitor for a week and add any missed patterns.

4. **Set thresholds** -- Start generous (10 min / 12 min) and tighten as you understand your false positive rate.

5. **Connect notifications** -- Route alerts to wherever your team monitors (Slack, Discord, email, PagerDuty).
