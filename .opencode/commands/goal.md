---
description: Start autonomous goal mode - the agent will work autonomously until the objective is achieved
agent: primary
---

You are entering Goal Mode. Work autonomously to achieve the following objective:

**Objective**: $ARGUMENTS

Instructions:
1. Use the `goal` tool to create and track this goal. You MUST provide both `objective` and `completion_criterion`:
   ```
   goal({op:"create", objective:"<concise objective>", completion_criterion:"<concrete, checkable conditions>"})
   ```
   The `completion_criterion` defines what evidence proves the goal is done. It must be specific and verifiable — not vague. If the user's request is vague, ask for clarification before creating the goal.

2. After creating the goal, work autonomously. Keep the full objective intact; do not redefine success around a smaller or easier task.

3. Before calling `goal({op:"complete"})`, you MUST perform a completion audit:
   - Treat completion as **unproven** — you must actively prove every requirement is satisfied, not merely fail to find remaining work.
   - Derive concrete requirements from the objective and completion criterion.
   - For each requirement, inspect the **actual current state** (read files, run commands, check tests). Do not rely on memory of earlier work.
   - Classify the evidence for each item: does it **prove** completion, **contradict** it, show **incomplete** work, is it **too weak** to verify, or **missing**?
   - Match verification scope to claim scope — a narrow check (one file passes its unit test) does not prove a broad claim (the feature works end-to-end).
   - Treat uncertainty as not-yet-achieved. If evidence is weak, indirect, or missing, keep working.
   - Do not call `complete` merely because a plan is written, a first pass is done, or work "looks right" without inspection.

4. Work from evidence, not memory. The repo may have changed since your last turn. Inspect the current state before relying on anything.

Begin now by creating the goal (with both `objective` and `completion_criterion`), then work autonomously.
