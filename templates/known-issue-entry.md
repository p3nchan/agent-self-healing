# Known Issue Entry Template

Use this format to document each failure pattern in your failure catalog.

---

### ISSUE-ID

- **Detect**: `log pattern or regex to match`
- **Symptom**: What the user or operator sees when this happens
- **Auto-action**: What the system does automatically. Options:
  - `kill [target]` — terminate the stuck process/session
  - `notify` — alert the ops channel
  - `log only` — record but don't act (for self-healing issues fixed via prompt/config)
  - `escalate` — trigger a higher-tier analysis
- **Notify**: Message template sent to ops channel (or "none" if the issue self-heals)
- **First seen**: YYYY-MM-DD
- **Root cause**: What actually causes this (fill in after investigation)
- **Prevention**: What was done to prevent recurrence

---

## Example Entry

### API-TIMEOUT-CASCADE

- **Detect**: `timeout exceeded` × 3+ within 10 minutes in the same session
- **Symptom**: User sees loading spinner, then error. Task appears stuck.
- **Auto-action**: Kill the session after 3rd consecutive timeout. Trigger checkpoint scan.
- **Notify**: "Session [KEY] hit 3 consecutive API timeouts. Terminated and checking for interrupted tasks."
- **First seen**: 2026-03-15
- **Root cause**: LLM provider rate limiting during peak hours
- **Prevention**: Added exponential backoff with jitter. Reduced default timeout from 600s to 300s.
