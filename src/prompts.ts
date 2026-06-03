// ─── Command Template (injected via config hook) ──────────────────────────────

export const GOAL_COMMAND_TEMPLATE = `You are entering Goal Mode. Work autonomously to achieve the following objective:

**Objective**: $ARGUMENTS

Instructions:
1. Use the \`goal\` tool to create and track this goal. You MUST provide both \`objective\` and \`completion_criterion\`:
   \`\`\`
   goal({op:"create", objective:"<concise objective>", completion_criterion:"<concrete, checkable conditions>"})
   \`\`\`
   The \`completion_criterion\` defines what evidence proves the goal is done. It must be specific and verifiable — not vague. If the user's request is vague, ask for clarification before creating the goal.

2. After creating the goal, work autonomously. Keep the full objective intact; do not redefine success around a smaller or easier task.

3. Before calling \`goal({op:"complete"})\`, you MUST perform a completion audit:
   - Treat completion as **unproven** — you must actively prove every requirement is satisfied, not merely fail to find remaining work.
   - Derive concrete requirements from the objective and completion criterion.
   - For each requirement, inspect the **actual current state** (read files, run commands, check tests). Do not rely on memory of earlier work.
   - Classify the evidence for each item: does it **prove** completion, **contradict** it, show **incomplete** work, is it **too weak** to verify, or **missing**?
   - Match verification scope to claim scope — a narrow check (one file passes its unit test) does not prove a broad claim (the feature works end-to-end).
   - Treat uncertainty as not-yet-achieved. If evidence is weak, indirect, or missing, keep working.
   - Do not call \`complete\` merely because a plan is written, a first pass is done, or work "looks right" without inspection.

4. Work from evidence, not memory. The repo may have changed since your last turn. Inspect the current state before relying on anything.

Begin now by creating the goal (with both \`objective\` and \`completion_criterion\`), then work autonomously.`

// ─── Continuation Prompt (injected via promptAsync on idle) ────────────────────

export function continuationPrompt(objective: string, completionCriterion: string): string {
  return `Continue working toward the active goal.

<objective>
${objective}
</objective>

<completion_criterion>
${completionCriterion}
</completion_criterion>

Continuation behavior:
- This goal persists across turns. Ending this turn does not require shrinking the objective to what fits now.
- Keep the full objective intact. If it cannot be finished now, make concrete progress toward the real requested end state, leave the goal active, and do not redefine success around a smaller or easier task.
- Temporary rough edges are acceptable while the work is moving in the right direction. Completion still requires the requested end state to be true and verified.

Work from evidence:
Use the current worktree and external state as authoritative. Previous conversation context can help locate relevant work, but inspect the current state before relying on it. Improve, replace, or remove existing work as needed to satisfy the actual objective.

Fidelity:
- Optimize each turn for movement toward the requested end state, not for the smallest stable-looking subset or easiest passing change.
- Do not substitute a narrower, safer, smaller, merely compatible, or easier-to-test solution because it is more likely to pass current tests.
- Treat alignment as movement toward the requested end state. An edit is aligned only if it makes the requested final state more true; useful-looking behavior that preserves a different end state is misaligned.

Completion audit:
Before deciding that the goal is achieved, treat completion as unproven and verify it against the actual current state:
- Derive concrete requirements from the objective, completion criterion, and any referenced files, plans, specifications, issues, or user instructions.
- Preserve the original scope; do not redefine success around the work that already exists.
- For every explicit requirement, numbered item, named artifact, command, test, gate, invariant, and deliverable, identify the authoritative evidence that would prove it, then inspect the relevant current-state sources: files, command output, test results, PR state, rendered artifacts, runtime behavior, or other authoritative evidence.
- For each item, determine whether the evidence proves completion, contradicts completion, shows incomplete work, is too weak or indirect to verify completion, or is missing.
- Match the verification scope to the requirement's scope; do not use a narrow check to support a broad claim.
- Treat tests, manifests, verifiers, green checks, and search results as evidence only after confirming they cover the relevant requirement.
- Treat uncertain or indirect evidence as not achieved; gather stronger evidence or continue the work.
- The audit must prove completion, not merely fail to find obvious remaining work.

Do not rely on intent, partial progress, memory of earlier work, or a plausible final answer as proof of completion. Marking the goal complete is a claim that the full objective has been finished and can withstand requirement-by-requirement scrutiny. Only mark the goal achieved when current evidence proves every requirement has been satisfied and no required work remains. If the evidence is incomplete, weak, indirect, merely consistent with completion, or leaves any requirement missing, incomplete, or unverified, keep working instead of marking the goal complete.

If the objective is achieved, call \`goal({op:"complete"})\`. Do not call \`goal({op:"complete"})\` unless the goal is actually complete. Do not mark a goal complete merely because the budget is nearly exhausted or because you are stopping work.

If the work is not done, just keep working. Do not narrate that you are continuing — execute.`
}
