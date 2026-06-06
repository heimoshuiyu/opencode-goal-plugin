# OpenCode Goal Plugin

An [OpenCode](https://opencode.ai) plugin that enables autonomous goal-driven agent mode. Set an objective, and the agent works across multiple turns — reading, writing, editing, and verifying — until the goal is fully achieved.

[中文文档](./README.zh.md)

## Features

- **Autonomous multi-turn execution** — The agent continues working turn after turn until the objective is met.
- **Goal lifecycle management** — Create, pause, resume, cancel, and complete goals via a dedicated `goal` tool.
- **Independent completion verification** — A built-in `goal-verify` sub-agent inspects the codebase from scratch before marking a goal complete.
- **Interrupt auto-pause** — Pressing `Esc` automatically pauses the goal instead of triggering another continuation.
- **Session persistence** — Goal state is stored in `Session.metadata` (SQLite), surviving server restarts.
- **Session fork inheritance** — Forked sessions automatically inherit the parent's goal state.

## How It Works

```
User: /goal Implement user login
  │
  ▼
┌──────────────────────────────────────────────┐
│  Turn 1                                       │
│  - Reads /goal command template               │
│  - Calls goal({op:"create", ...})             │
│  - Starts working (read, edit, bash, etc.)    │
└──────────────┬───────────────────────────────┘
               │
               ▼  (session.status → idle)
┌──────────────────────────────────────────────┐
│  Plugin event hook                            │
│  1. Receives session.status idle event        │
│  2. Reads Session.metadata.goal → active      │
│  3. client.promptAsync(continuationPrompt)    │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│  Turn 2 (autonomous continuation)             │
│  - Continues working...                       │
└──────────────┬───────────────────────────────┘
               │
               ▼  (loops until goal is complete)
┌──────────────────────────────────────────────┐
│  Agent calls goal({op:"complete"})            │
│  → Blocked: must use goal-verify sub-agent    │
│  → Sub-agent inspects codebase independently  │
│  → If verified → goal marked complete         │
│  → If not → agent keeps working               │
└──────────────────────────────────────────────┘
```

## Setup

Add the plugin to your [OpenCode config](https://opencode.ai/docs/config/):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@heimoshuiyu/opencode-goal-plugin"]
}
```

OpenCode will automatically install the plugin on next run.

## Usage

### Starting a Goal

Type `/goal` in the chat followed by your objective:

```
/goal Refactor the authentication module to use JWT tokens
```

The agent will create a goal with the objective, then work autonomously across multiple turns.

### Goal Tool Operations

The `goal` tool supports these operations:

| Operation     | Description                                                        |
| ------------- | ------------------------------------------------------------------ |
| `create`      | Starts a new goal. Requires `objective` and `completion_criterion`. |
| `get`         | Returns the current goal state.                                    |
| `pause`       | Pauses an active goal.                                             |
| `resume`      | Re-activates a paused goal.                                        |
| `cancel`      | Discards the current goal entirely.                                |
| `complete`    | Marks the goal as complete (triggers verification sub-agent).      |

### Completion Verification

When the agent believes the goal is done, it calls `goal({op:"complete"})`. This is **blocked** in the main session — instead, a `goal-verify` sub-agent is launched to independently inspect the codebase:

1. Retrieves the objective and completion criterion from `goal({op:"get"})`.
2. Verifies each deliverable against the current state (reads files, runs tests, checks integrations).
3. If all requirements are satisfied → marks the goal complete.
4. If any gap is found → returns a report, and the main agent keeps working.

This prevents premature completion and ensures real evidence-based verification.

### Interrupting

Press `Esc` during agent execution to interrupt. The plugin detects the abort event and automatically pauses the goal — no unintended continuations will fire.

Resume later with `/goal resume` or by asking the agent to continue.

## Plugin Hooks

| Hook                                 | Purpose                                              |
| ------------------------------------ | ---------------------------------------------------- |
| `tool`                               | Registers the `goal` tool                            |
| `config`                             | Injects `/goal` command and `goal-verify` sub-agent  |
| `chat.message`                       | Injects goal context into sub-agent messages         |
| `command.execute.before`             | Marks `/goal` template parts as synthetic (hidden)   |
| `event`                              | Monitors idle/abort events for continuation/pause    |

## License

MIT
