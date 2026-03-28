# Prohibition-First Prompts

## The Problem

When you give a cheap LLM a monitoring task and access to tools, it will hallucinate tool calls. This isn't theoretical -- it's the #1 source of monitoring noise in production.

In our first deployment, gemini-flash as a heartbeat monitor generated **80%+ of all error logs** in a single day:

```
canvas failed: node required                     ×4
message failed: chat not found                   ×4
message failed: Action requires a target          ×7
exec failed: command not found: rss-tool
exec failed: command not found: fugle
exec failed: command not found: gog.sh
edit failed: Missing required parameter: oldText
components.blocks[0].type must be a supported component block
```

The model was supposed to check if sessions were alive. Instead, it tried to generate images, execute arbitrary commands, edit files, and send Slack-formatted messages to a Discord channel.

Worse: one sub-agent read the output of a maintenance script that said "Restart gateway to apply changes" and **actually executed `gateway restart`**, causing an unscheduled system restart. Four layers of defense were needed to prevent recurrence.

## The Pattern

**Start the prompt with an explicit tool whitelist. Everything not on the list is banned.**

### Structure

```markdown
# Monitor Prompt

## Allowed Tools (Whitelist)

**You may ONLY use these tools:**

- tool_a -- [what it does]
- tool_b -- [what it does]
- tool_c -- [what it does]

**ALL other tools are PROHIBITED, including but not limited to:**
`exec`, `read`, `edit`, `write`, `web_search`, `image`, `canvas`, [gateway operations]

---

## Your Task

[Task description comes AFTER the prohibitions]
```

### Why This Order Matters

LLMs process prompts sequentially. If the task description comes first, the model builds an execution plan before encountering constraints. Constraints applied after planning are weaker than constraints applied before.

By leading with prohibitions:
1. The model's planning is immediately bounded
2. Tool hallucination is suppressed at the generative level, not filtered after
3. The explicit "including but not limited to" catches tools the prompt author didn't think of

## Real Example

Here's the actual heartbeat prompt structure that reduced monitoring errors to near-zero:

```markdown
# Heartbeat v6

## Allowed Tools (Whitelist)

**You may ONLY use these tools:**

- sessions_list -- View active sessions
- sessions_send -- Send a message to a session
- subagents list -- View sub-agents
- subagents kill -- Terminate stuck sub-agents
- message -- Send notifications to ops channel ONLY

**ALL other tools are PROHIBITED, including but not limited to:**
exec, read, edit, web_search, canvas, image, gateway

---

## Your One Task: Session Liveness

### Step 1: List sessions
Call sessions_list.

### Step 2: Check each session
[specific checks with specific thresholds]

### Step 3: If everything is fine
Reply ONLY with: HEARTBEAT_OK
```

## Design Principles

### 1. Whitelist, Not Blacklist

Don't list what the model can't do. List what it CAN do. Everything else is implicitly banned. The explicit "including but not limited to" blacklist catches the most common hallucinations.

### 2. Minimal Tool Set

The heartbeat uses exactly 5 tools. Not 10. Not "all the session management tools." Five specific tools with specific purposes.

Each tool added to the whitelist is a surface area for hallucination. If the model doesn't need it for THIS specific task, remove it.

### 3. Explicit Normal Output

Define what "nothing to report" looks like:

```
HEARTBEAT_OK
```

Without this, the model will fill silence with activity -- fabricating observations, generating unnecessary notifications, or invoking tools "just to check."

### 4. No Gateway/System Operations

Never give a monitoring agent the ability to restart, reconfigure, or modify the system it monitors. This is the "agent reads restart command and executes it" failure mode.

Even if the monitor correctly identifies that a restart would help, the decision to restart should require human approval or a separate, purpose-built restart mechanism with its own safety checks.

### 5. Scope Sentences, Not Paragraphs

Each step in the prompt should be one clear instruction. Cheap models (flash/haiku) lose focus in long paragraphs. Short, imperative sentences with specific numbers:

```markdown
Good:  "> 15 minutes silent → send nudge"
Bad:   "If a session has been inactive for a while, consider sending a gentle reminder"
```

## Anti-Patterns

### "Use good judgment"

Never tell a monitoring LLM to "use good judgment." It will interpret log entries, infer intentions, and take creative action. Monitoring should be mechanical, not creative.

### "Handle errors appropriately"

The model will hallucinate error handling paths. Specify exactly: "If tool call fails, log the error and continue. Do not retry."

### "Notify the team if something seems wrong"

"Seems wrong" is unbounded. Specify exact conditions: "> 20 minutes inactive AND session type is isolated → notify."

### Tool descriptions in the prompt

Don't describe what tools do beyond one sentence. Extended tool descriptions prime the model to use them in creative ways. Keep descriptions minimal and functional.

## Measuring Success

After deploying a prohibition-first prompt:

- **Error log volume** should drop dramatically (ours dropped >80%)
- **False positive notifications** should approach zero
- **Heartbeat cost** should be negligible (ours: ~$0/month on gemini-flash free tier)
- **The "HEARTBEAT_OK" ratio** should be >95% of all runs

If your monitoring LLM is producing output on most runs, the prompt is too permissive.

## Defense in Depth

The prohibition-first prompt is one layer of defense. For critical safety (like preventing system restarts), use multiple layers:

1. **Script output** -- Don't write "run this command to apply." Write "changes take effect after next cycle."
2. **Prompt prohibition** -- Explicitly ban the dangerous action in the LLM prompt
3. **Monitor prompt prohibition** -- Ban it again in the heartbeat/watchdog prompt
4. **Safety-net prompt prohibition** -- Ban it in the watchdog-of-the-watchdog prompt

Four layers may seem excessive. But the restart incident proved that each layer catches what the others miss.
