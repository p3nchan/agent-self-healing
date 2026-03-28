# Cost Model Evolution

A timeline of how the monitoring cost changed across 14 design iterations, and what we learned at each step.

## Timeline

```
Phase 1-2:   gemini-flash heartbeat (all-in-one)     ~$0    but 80% error rate
Phase 3:     Deploy as system heartbeat               ~$0    errors continue
Phase 5a:    Add tool calling guardrails              ~$0    errors drop ~50%
Phase 7:     Prohibition-first rewrite (v5.0)         ~$0    errors drop ~90%
Phase 9:     Switch to haiku-4-5                      ~$300/mo  errors near-zero but expensive
Phase 12:    Switch back to gemini-flash              ~$0    errors near-zero (prompt fixed)
Phase 13:    Three-layer split                        ~$0    stable architecture
Phase 14:    Current (observation)                    ~$0    production-stable
```

## Key Lessons

### 1. The model isn't the problem -- the prompt is

We blamed gemini-flash for hallucinating tools. We switched to haiku ($300/mo). Then we realized: if we just constrained the prompt properly, flash worked fine at $0.

**Lesson**: Before upgrading the model, simplify the prompt.

### 2. Complexity migrates, it doesn't disappear

When we simplified the heartbeat prompt, all the complex checks (log analysis, checkpoint management, context monitoring) had to go somewhere. They moved to Layer 3 (hourly, graduated cost).

**Lesson**: Simplifying one component often means another component absorbs the complexity. Plan for it.

### 3. $0 is a valid architecture goal

The final system costs ~$0.10/month. This wasn't accidental -- it was a design constraint from the start. Every decision was evaluated against: "Can this be done without an LLM?"

**Lesson**: Set a cost target before designing. "As cheap as possible" is too vague. "$0 for the monitoring layer" is a concrete constraint that drives good architecture.

### 4. The free tier changes everything

gemini-flash on the free tier means 144 heartbeat runs/day at zero cost. This wouldn't work with any model that charges per-token. The architecture is designed around this economic reality.

**Lesson**: Know your provider's pricing model. Free tiers and flat-rate subscriptions enable architectures that per-token pricing makes impractical.
