import type { Plugin, PluginModule, PluginInput, Hooks, ToolContext, ToolResult } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { Session } from "@opencode-ai/sdk/v2"
import { GOAL_COMMAND_TEMPLATE, continuationPrompt } from "./prompts"

// ─── Types ────────────────────────────────────────────────────────────────────

type GoalStatus = "active" | "paused" | "complete"

interface GoalData {
  id: string
  objective: string
  completionCriterion: string
  status: GoalStatus
  continuationCount: number
  createdAt: number
  updatedAt: number
}

// ─── Goal Read/Write via Session.metadata ─────────────────────────────────────

async function readGoal(
  client: ReturnType<typeof createOpencodeClient>,
  sessionID: string,
): Promise<{ goal: GoalData | null; session: Session | null }> {
  const session = await getSession(client, sessionID)
  if (!session?.metadata?.goal) return { goal: null, session }
  return { goal: session.metadata.goal as GoalData, session }
}

async function writeGoal(
  client: ReturnType<typeof createOpencodeClient>,
  sessionID: string,
  goal: GoalData | null,
  existingSession?: Session | null,
): Promise<void> {
  const session = existingSession ?? await getSession(client, sessionID)
  if (!session) throw new Error("Failed to get session")

  const existing: Record<string, unknown> = session.metadata ?? {}
  let metadata: Record<string, unknown>

  if (goal === null) {
    const { goal: _, ...rest } = existing
    metadata = rest
  } else {
    metadata = { ...existing, goal }
  }

  await client.session.update({ sessionID, metadata })
}

async function getSession(
  client: ReturnType<typeof createOpencodeClient>,
  sessionID: string,
): Promise<Session | null> {
  try {
    const result = await client.session.get({ sessionID })
    return (result as any)?.data as Session | undefined ?? null
  } catch {
    return null
  }
}

// ─── Goal State Machine ───────────────────────────────────────────────────────

function createGoal(objective: string, completionCriterion: string): GoalData {
  const now = Date.now()
  return {
    id: `goal_${now}_${Math.random().toString(36).slice(2, 8)}`,
    objective: objective.trim(),
    completionCriterion: completionCriterion.trim(),
    status: "active",
    continuationCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function canTransitionTo(goal: GoalData, targetStatus: GoalStatus): boolean {
  switch (targetStatus) {
    case "paused":
      return goal.status === "active"
    case "active": // resume
      return goal.status === "paused"
    case "complete":
      return goal.status === "active"
    default:
      return false
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const serverPlugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  // The plugin system provides a V1 SDK client, but we use V2 internally
  // for cleaner types (Session.metadata, Session.parentID, flat parameters).
  // We reuse the underlying HTTP client (fetch + auth headers) from V1.
  const v1Client = (input.client as any)._client
  const v1Config = v1Client?.getConfig?.() ?? {}
  const client = createOpencodeClient({
    baseUrl: input.serverUrl.origin,
    headers: v1Config.headers,
    fetch: v1Config.fetch,
  })

  // ── Goal Tool ─────────────────────────────────────────────────────────────

  const goalTool = tool({
    description: `Manage the active goal-mode objective.

Use a single \`op\` field:
- \`create\` starts a goal. Requires both \`objective\` and \`completion_criterion\`.
- \`get\` returns the current goal.
- \`resume\` re-activates a paused goal so work can continue.
- \`complete\` marks the goal complete after you have verified every deliverable in the completion criterion against current evidence.
- \`cancel\` discards the current goal entirely (deletes it).
- \`pause\` pauses the active goal.

Completion rules:
Set \`complete\` only when the objective has actually been achieved and no required work remains. The completion call is a load-bearing claim that ends the autonomous loop and surfaces a "done" report to the user.

Do NOT call \`complete\`:
- Merely because a turn is ending or budget is nearly exhausted.
- After only producing a plan, summary, first pass, or partial result.
- Because you are stopping work or the task seems "good enough".
- Based on intent, partial progress, memory of earlier work, or a plausible answer.

Only call \`complete\` when current evidence proves every requirement has been satisfied.`,
    args: {
      op: tool.schema
        .enum(["create", "get", "complete", "resume", "cancel", "pause"])
        .describe("Goal operation"),
      objective: tool.schema
        .string()
        .optional()
        .describe("Goal objective (required for create)"),
      completion_criterion: tool.schema
        .string()
        .optional()
        .describe("Concrete, checkable conditions that prove the goal is done (required for create)"),
    },
    async execute(args, ctx: ToolContext): Promise<ToolResult> {
      const { sessionID } = ctx

      // Sub-agent sessions (created by Task tool) must not use the goal tool.
      // If a sub-agent has a goal, idle events would trigger background continuations
      // that run invisibly, burning tokens without returning results to the parent session.
      const session = await getSession(client, sessionID)
      if (session?.parentID) {
        return "Error: the goal tool is not available in sub-agent sessions. Goals can only be managed in the main session."
      }

      switch (args.op) {
        case "create": {
          if (!args.objective?.trim()) {
            return "Error: objective is required when op=create"
          }
          if (!args.completion_criterion?.trim()) {
            return "Error: completion_criterion is required when op=create. You must define concrete, checkable conditions that prove the goal is done. If the user's request is vague, ask for clarification before creating the goal."
          }
          const { goal: existing, session } = await readGoal(client, sessionID)
          if (existing && existing.status === "active") {
            return `Error: an active goal already exists: "${existing.objective}"`
          }
          const goal = createGoal(args.objective, args.completion_criterion)
          await writeGoal(client, sessionID, goal, session ?? undefined)
          return `Goal created: "${goal.objective}"\nCompletion criterion: ${goal.completionCriterion}\nStatus: active\nID: ${goal.id}`
        }

        case "get": {
          const { goal } = await readGoal(client, sessionID)
          if (!goal) return "No active goal."
          return formatGoalResponse(goal)
        }

        case "complete": {
          const { goal, session } = await readGoal(client, sessionID)
          if (!goal) return "No goal to complete."
          if (!canTransitionTo(goal, "complete")) {
            return `Goal is not active (status: ${goal.status}). Only active goals can be completed.`
          }
          goal.status = "complete"
          goal.updatedAt = Date.now()
          await writeGoal(client, sessionID, goal, session ?? undefined)
          return `Goal completed: "${goal.objective}"`
        }

        case "resume": {
          const { goal, session } = await readGoal(client, sessionID)
          if (!goal) return "No goal to resume."
          if (!canTransitionTo(goal, "active")) {
            return `Goal cannot be resumed (status: ${goal.status}). Only paused goals can be resumed.`
          }
          goal.status = "active"
          goal.updatedAt = Date.now()
          goal.continuationCount = 0
          await writeGoal(client, sessionID, goal, session ?? undefined)
          return `Goal resumed: "${goal.objective}"\nStatus: active`
        }

        case "pause": {
          const { goal, session } = await readGoal(client, sessionID)
          if (!goal) return "No goal to pause."
          if (!canTransitionTo(goal, "paused")) {
            return `Goal cannot be paused (status: ${goal.status}). Only active goals can be paused.`
          }
          goal.status = "paused"
          goal.updatedAt = Date.now()
          await writeGoal(client, sessionID, goal, session ?? undefined)
          return `Goal paused: "${goal.objective}"\nStatus: paused`
        }

        case "cancel": {
          const { goal, session } = await readGoal(client, sessionID)
          if (!goal) return "No goal to cancel."
          await writeGoal(client, sessionID, null, session ?? undefined)
          return `Goal cancelled: "${goal.objective}"`
        }
      }
    },
  })

  // ── Continuation Logic ────────────────────────────────────────────────────

  async function isLastMessageAborted(sessionID: string): Promise<boolean> {
    try {
      const result = await client.messages({ sessionID, limit: 1 })
      const messages = (result as any)?.data as Array<{ info: { role: string; error?: { name: string } } }> | undefined
      const last = messages?.[0]
      return last?.info?.role === "assistant" && last?.info?.error?.name === "MessageAbortedError"
    } catch {
      return false
    }
  }

  async function queueContinuation(sessionID: string) {
    const { goal } = await readGoal(client, sessionID)
    if (!goal || goal.status !== "active") return

    // User pressed Esc or called abort → pause the goal instead of continuing.
    if (await isLastMessageAborted(sessionID)) {
      goal.status = "paused"
      goal.updatedAt = Date.now()
      await writeGoal(client, sessionID, goal)
      return
    }

    goal.continuationCount++
    goal.updatedAt = Date.now()
    await writeGoal(client, sessionID, goal)

    try {
      await client.session.promptAsync({
        sessionID,
        parts: [
          {
            type: "text" as const,
            text: continuationPrompt(goal.objective, goal.completionCriterion),
            synthetic: true,
          },
        ],
      })
    } catch {
    }
  }

  // ── Return Hooks ──────────────────────────────────────────────────────────

  return {
    // Tool registration
    tool: {
      goal: goalTool,
    },

    // Config hook:
    // 1. Register the /goal command dynamically so the plugin works as a
    //    standalone package without requiring a .opencode/commands/goal.md file.
    //    Opencode's bootstrap calls plugin.init() before other services, so
    //    injecting cfg.command here is visible when Command.Service initializes.
    // 2. Deny the goal tool in all sub-agent sessions so it never appears in
    //    their LLM context. This is the primary defense; the runtime parentID
    //    check in execute() is a safety net.
    config(cfg: Record<string, unknown>) {
      // ── Inject /goal command ────────────────────────────────────────────
      if (!cfg.command) {
        cfg.command = {}
      }
      const commands = cfg.command as Record<string, { template: string; description?: string; agent?: string; subtask?: boolean }>
      if (!commands["goal"]) {
        commands["goal"] = {
          template: GOAL_COMMAND_TEMPLATE,
          description: "Start autonomous goal mode - the agent will work autonomously until the objective is achieved",
        }
      }

      // ── Deny goal tool for sub-agents ────────────────────────────────────
      const agents = cfg.agent as Record<string, { mode?: string; permission?: Record<string, unknown> }> | undefined
      if (!agents) return
      for (const agent of Object.values(agents)) {
        if (agent.mode === "subagent") {
          agent.permission = { ...agent.permission, goal: "deny" }
        }
      }
    },

    // Event hook: listen for session idle → trigger continuation
    async event({ event }) {
      const evt = event as { type: string; properties: Record<string, any> }

      // Session turn ended → check if we should queue continuation
      if (evt.type === "session.status" && evt.properties?.status?.type === "idle") {
        const sessionID: string | undefined = evt.properties.sessionID
        if (sessionID) {
          void queueContinuation(sessionID)
        }
      }

      // User message created → reset continuation counter
      // (user intervention = start a fresh autonomous cycle)
      if (evt.type === "message.updated" && evt.properties?.info?.role === "user") {
        const sessionID: string | undefined = evt.properties.sessionID
        if (sessionID) {
          const { goal, session } = await readGoal(client, sessionID)
          if (goal) {
            goal.continuationCount = 0
            await writeGoal(client, sessionID, goal, session ?? undefined)
          }
        }
      }
    },
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatGoalResponse(goal: GoalData): string {
  const lines = [
    `Goal: ${goal.objective}`,
    `Completion criterion: ${goal.completionCriterion}`,
    `Status: ${goal.status}`,
    `ID: ${goal.id}`,
    `Created: ${new Date(goal.createdAt).toISOString()}`,
    `Updated: ${new Date(goal.updatedAt).toISOString()}`,
  ]
  return lines.join("\n")
}

// ─── V1 Plugin Module Export ──────────────────────────────────────────────────

const pluginModule: PluginModule = {
  id: "opencode-goal-plugin",
  server: serverPlugin,
}

export default pluginModule
