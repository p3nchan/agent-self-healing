<p align="center">
  <img src="assets/banner.webp" alt="Agent Self-Healing" width="100%">
</p>

# Agent Self-Healing

**Keep your AI agents alive without babysitting them.** A three-layer self-healing architecture for autonomous AI agent systems, born from months of running 5+ agents across multiple models 24/7.

The core insight: **AI agents fail in ways traditional monitoring can't see.** A process can be alive while the agent is semantically stuck -- it made a promise, started a task, and silently stopped. This system detects those failures and recovers from them, at near-zero cost.

> Most agent monitoring asks "is the process running?" We ask "did the agent keep its promise?"

---

## The Problem

Long-running AI agents fail in unique ways:

- **Silent stalls** -- the agent is "running" but hasn't produced output in 20 minutes
- **Broken promises** -- "I'll be right back in 5 minutes" ... silence
- **Tool hallucination** -- the LLM invents tool calls that don't exist, filling error logs with noise
- **Cascade restarts** -- one restart triggers another, creating a storm
- **Orphaned tasks** -- a session dies mid-task, and nobody notices
- **Context overflow** -- the agent's context fills up, quality degrades, then it crashes
- **Monitor-induced failures** -- your health check LLM starts executing dangerous commands it reads from logs

Traditional process monitors catch none of these. You need monitoring that understands what agents *do*, not just whether they're *alive*.

<img src="assets/sections/architecture.webp" alt="Architecture" width="100%">

## Architecture: Three Layers + Safety Net

```
Layer 0   Continuous   No LLM    $0        Channel disconnect detection + auto-reconnect
Layer 1   Every 5m     Shell     $0        Process health + heartbeat activity + promise detection
Layer 2   Every 15m    Flash     ~$0       Session liveness + stall detection + visibility pulse
Layer 3   Every 60m    Graduated ~$0.01    Deep analysis: checkpoints, context, logs, disk
```

Frequency follows a 3x progression: **5m → 15m → 60m.** The cheaper the layer, the more often it runs. Each layer has a strict scope -- no layer duplicates another's work.

**Key design principles:**
- **Cost is architecture** -- the layer split isn't just engineering, it's a budget strategy. Shell does everything shell can do ($0). Cheap LLM does only what requires language understanding (~$0). Expensive LLM is summoned only for judgment calls. Frequency is proportional to cost: the $0 layer runs 12x more often than the LLM layer.
- **Prohibition-first prompts** -- the LLM monitor's prompt starts with what it *cannot* do, not what it should do. This prevents tool hallucination, the #1 source of monitoring noise.
- **Zero noise** -- if nothing is wrong, no notification is sent. Ever.
- **Thread-as-checkpoint** -- when a session dies without a checkpoint, the conversation history itself becomes the recovery source.

---

## Quick Start

### 1. Understand the layers

Read the [Architecture Guide](docs/architecture.md) to understand what each layer does and why.

### 2. Deploy Layer 1 (Shell Watchdog)

The shell watchdog is the foundation. It needs no LLM and costs nothing.

```bash
# Clone
git clone https://github.com/p3nchan/agent-self-healing.git
cd agent-self-healing

# Configure
cp scripts/config.sh scripts/config.local.sh
# Edit config.local.sh with your paths and settings

# Test manually
bash scripts/process-watchdog.sh
echo "Exit code: $?"

# Add to crontab (every 5 minutes — it's $0, run it often)
crontab -e
# */5 * * * * /bin/bash /path/to/agent-self-healing/scripts/process-watchdog.sh
```

### 3. Deploy Layer 1.5 (Promise Watchdog)

The promise watchdog reads agent transcripts and detects broken promises. Requires Node.js.

```bash
# Configure transcript path
export SESSION_STORE="/path/to/your/sessions.json"
export NOTIFY_COMMAND="your-notification-cli send --message"

# Test
node scripts/promise-watchdog.mjs --dry-run

# The process-watchdog.sh calls this automatically if configured
```

### 4. Set up Layer 2 (LLM Heartbeat)

Copy the [heartbeat prompt template](templates/heartbeat-prompt.md) and customize it for your platform. The template uses a prohibition-first design that prevents the LLM from hallucinating dangerous tool calls.

### 5. Set up Layer 3 (Hourly Deep Analysis)

Layer 3 runs less frequently and handles complex checks. See [Architecture Guide](docs/architecture.md#layer-3-hourly-deep-analysis) for what to include.

<img src="assets/sections/patterns.webp" alt="Patterns" width="100%">

## What's Inside

### Docs

| Document | What You'll Learn |
|----------|-------------------|
| [Architecture](docs/architecture.md) | The three-layer design, what each layer does, and why they're separated |
| [Prohibition-First Prompts](docs/prohibition-first-prompts.md) | How to write LLM monitor prompts that don't backfire |
| [Cost Architecture](docs/cost-architecture.md) | Why layer separation IS cost control, with real numbers |
| [Promise Detection](docs/promise-detection.md) | NLP-based detection of unfulfilled agent commitments |
| [Checkpoint & Resume](docs/checkpoint-resume.md) | Task state management and automatic recovery after crashes |
| [Failure Catalog](docs/failure-catalog.md) | 23 real failure patterns from production, categorized and actionable |

### Scripts

| Script | Layer | Language | Dependencies |
|--------|-------|----------|--------------|
| [process-watchdog.sh](scripts/process-watchdog.sh) | L1 | Bash | curl, pgrep |
| [promise-watchdog.mjs](scripts/promise-watchdog.mjs) | L1 | Node.js 18+ | None (stdlib only) |
| [config.sh](scripts/config.sh) | -- | Bash | -- |

### Templates

| Template | Format | Use Case |
|----------|--------|----------|
| [Heartbeat Prompt](templates/heartbeat-prompt.md) | Markdown | LLM monitor prompt with prohibition-first design |
| [Watchdog Prompt](templates/watchdog-prompt.md) | Markdown | Safety-net prompt for monitoring the monitor |
| [Checkpoint](templates/checkpoint.json) | JSON | Task state tracking for crash recovery |
| [Known Issue Entry](templates/known-issue-entry.md) | Markdown | Template for documenting new failure patterns |

### Examples

| Example | Platform |
|---------|----------|
| [Claude Code](examples/claude-code.md) | Claude Code with subagents |
| [Chat Bots](examples/chat-bots.md) | Discord / Telegram / Slack bots |
| [Custom Agents](examples/custom-agents.md) | Any LLM agent system |

---

## The Failure Catalog

This system was built from observed failures, not theory. The [Failure Catalog](docs/failure-catalog.md) documents 23 real production incidents, grouped into categories:

| Category | Count | Example |
|----------|-------|---------|
| Tool Hallucination | 5 | LLM invents `rss-tool`, `fugle`, Slack Block Kit calls |
| Cross-Context Leak | 3 | Discord IDs used as Telegram chat IDs |
| Restart Cascade | 4 | Agent reads "restart gateway" from script output and executes it |
| Session Stall | 4 | Promise made, never fulfilled; user waiting indefinitely |
| Infrastructure | 5 | Auth token rotation, DNS issues, rate limits |
| Downstream Effects | 2 | Webhook expiry from slow response, interaction timeouts |

Each entry includes: pattern to detect, visible symptoms, automated action, and notification template.

---

## Design Decisions

### Why prohibition-first?

Our LLM monitor (gemini-flash) generated 80%+ of all error logs in its first deployment. It hallucinated tool calls (`canvas`, `exec`, `edit`, `web_search`), used Discord channel IDs as Telegram chat IDs, and even executed a gateway restart command it read from a script's output.

The fix: **start the prompt with an explicit whitelist of allowed tools.** Everything not on the list is banned. This reduced monitoring noise to near-zero.

See [Prohibition-First Prompts](docs/prohibition-first-prompts.md) for the full pattern.

### Why shell + LLM + LLM?

We tried three approaches before landing on the current design:

| Approach | Cost | Problem |
|----------|------|---------|
| LLM-only (gemini-flash) | ~$0 | Tool hallucination, 80%+ error rate |
| LLM-only (haiku) | ~$300/mo | Works but too expensive for 96 runs/day |
| Shell-only | $0 | Can't detect semantic stalls or broken promises |
| **Shell + cheap LLM + graduated LLM** | **~$0** | **Each layer does only what it's uniquely suited for** |

See [Cost Architecture](docs/cost-architecture.md) for the full analysis.

### Why stateless restart counting?

Instead of maintaining a restart counter file (which can become stale or corrupted), the system counts recovery markers in the conversation thread itself. The conversation channel IS the state store. Maximum 2 auto-restarts per thread, enforced by counting markers in thread history.

---

## Requirements

- **Layer 1**: Bash 4+, curl, pgrep, Node.js 18+ (for promise watchdog)
- **Layer 2**: Any LLM API (designed for cheap models: gemini-flash, haiku, etc.)
- **Layer 3**: Any LLM API (supports graduated model selection)
- **Notification**: Any CLI tool that can send messages (Discord webhook, Telegram bot, Slack, email, etc.)

---

## Related Projects

- [Orchestration Playbook](https://github.com/p3nchan/orchestration-playbook) -- Operational patterns for multi-agent systems (includes Checkpoint & Resume pattern)
- [Auto Optimization](https://github.com/p3nchan/auto-optimization) -- Automated workspace hygiene (the Layer 3 hourly analysis)
- [Prompt Shielder](https://github.com/p3nchan/prompt-shielder) -- Config integrity monitoring for AI agents

---

## License

MIT -- see [LICENSE](LICENSE).
