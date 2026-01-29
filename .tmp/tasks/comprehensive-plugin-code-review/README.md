# Comprehensive Plugin Code Review - Task Breakdown

## Executive Summary

A comprehensive code review task breakdown has been created for the bot framework, covering all plugins, core modules, platform adapters, and CLI commands. The review is organized into 28 atomic subtasks with clear dependencies and parallelization opportunities.

**Task Location**: `.tmp/tasks/comprehensive-plugin-code-review/`

---

## Task Overview

| Property | Value |
|----------|-------|
| **Feature ID** | `comprehensive-plugin-code-review` |
| **Total Subtasks** | 28 |
| **Estimated Duration** | 40-60 hours total (1-2 hours per task) |
| **Review Focus Areas** | Security, Conventions, Best Practices, Bugs, Performance |
| **Acceptance Criteria** | Binary pass/fail for each subtask |

---

## Task Organization

### Phase 1: Core Foundation (Tasks 01-06)
*Must be completed first - all other tasks depend on these*

| Seq | Task | Files | Dependencies |
|-----|-------|-------|--------------|
| 01 | Database foundation | `core/database/client.ts` | None |
| 02 | Database repositories | `core/database/*.ts` | 01 |
| 03 | Event bus | `core/event-bus.ts` | None |
| 04 | Config & access control | `core/config.ts` | None |
| 05 | LLM client | `core/llm-client.ts` | None |
| 06 | Embedders | `core/embedder.ts`, `local-embedder.ts` | None |

**Parallelization**: Tasks 03, 04, 05, 06 can run in parallel after task 01.

---

### Phase 2: Core Infrastructure (Tasks 07-10)
*Depends on Phase 1*

| Seq | Task | Files | Dependencies |
|-----|-------|-------|--------------|
| 07 | Plugin loader | `core/plugin-loader.ts` | 01-06 |
| 08 | Tool loader | `core/tool-loader.ts` | 01-06 |
| 09 | Command registry | `core/command-registry.ts` | 01-06 |
| 10 | CLI framework | `core/cli/*.ts` | 01-06 |

**Parallelization**: All tasks can run in parallel once Phase 1 is complete.

---

### Phase 3: Plugin Reviews (Tasks 11-25)
*Depends on Core Infrastructure*

#### Message Handlers (Tasks 11-13) - Parallel
| Seq | Task | Files | Focus |
|-----|-------|-------|-------|
| 11 | Logger plugin | `app/plugins/message/logger.plugin.ts` | Message logging, embeddings, access control |
| 12 | Immich auto | `app/plugins/message/immich-auto.plugin.ts` | Immich API, file handling |
| 13 | Media auto | `app/plugins/message/media-auto.plugin.ts` | Social links, video compression |

#### Slash Commands (Tasks 14-20) - Parallel
| Seq | Task | Files | Focus |
|-----|-------|-------|-------|
| 14 | Memory command | `app/plugins/slash/memory/` | User memories, LLM integration |
| 15 | Profile command | `app/plugins/slash/profile/` | Profile generation, privacy |
| 16 | Media command | `app/plugins/slash/media/` | Media URL processing |
| 17 | Imagine command | `app/plugins/slash/imagine/` | Image generation, buttons |
| 18 | About command | `app/plugins/slash/about/` | Package info |
| 19 | Reminder command | `app/plugins/slash/reminder/` | Reminder CRUD, autocomplete |
| 20 | Knowledge command | `app/plugins/slash/knowledge/` | Guild knowledge, tags |

#### AI Tools (Task 21)
| Seq | Task | Files | Focus |
|-----|-------|-------|-------|
| 21 | All AI tools | `app/plugins/ai/tools/*.tool.ts` | 11 tools, API keys, schema validation |

#### AI Plugin (Task 22)
| Seq | Task | Files | Focus |
|-----|-------|-------|-------|
| 22 | AI orchestrator | `app/plugins/ai/ai.plugin.ts`, `services/` | LLM orchestration, tool filtering, streaming |

#### Timer Plugin (Task 23)
| Seq | Task | Files | Focus |
|-----|-------|-------|-------|
| 23 | Reminder timer | `app/plugins/timers/reminder.plugin.ts` | Scheduling, delivery, LLM commentary |

#### CLI Commands (Task 24)
| Seq | Task | Files | Focus |
|-----|-------|-------|-------|
| 24 | All CLI commands | `app/commands/*.command.ts` | Command parsing, validation, errors |

#### Stream Plugin (Task 25)
| Seq | Task | Files | Focus |
|-----|-------|-------|-------|
| 25 | Stream functionality | `app/plugins/stream/*.ts` | Stream service, subscriptions |

**Parallelization**: All tasks 11-25 can run in parallel once Phase 2 is complete.

---

### Phase 4: Platform Adapters (Tasks 26-27)
*Depends on all plugin reviews*

| Seq | Task | Files | Dependencies |
|-----|-------|-------|--------------|
| 26 | Discord adapter | `bot/discord/adapter.ts` | 11-25 |
| 27 | Slack adapter | `bot/slack/adapter.ts` | 11-25 |

**Parallelization**: Tasks can run in parallel after plugin reviews.

---

### Phase 5: Integration Review (Task 28)
*Final comprehensive audit*

| Seq | Task | Dependencies |
|-----|-------|--------------|
| 28 | Cross-plugin integration & security audit | All 01-27 |

---

## Parallel Execution Strategy

### Batch 1: Core Foundation (Parallel Group A)
- Tasks 01 (database client) - runs first
- Tasks 03, 04, 05, 06 - run in parallel after 01
- Task 02 - runs after 01

### Batch 2: Core Infrastructure (Parallel Group B)
- Tasks 07, 08, 09, 10 - run in parallel after Phase 1

### Batch 3: Plugin Reviews (Parallel Group C)
- Tasks 11-25 - run in parallel after Phase 2
- **This is the largest parallelization opportunity - 15 concurrent tasks**

### Batch 4: Platform Adapters (Parallel Group D)
- Tasks 26, 27 - run in parallel after plugin reviews

### Batch 5: Final Integration
- Task 28 - runs last, depends on everything

---

## Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: Core Foundation (Sequential + Parallel)           │
├─────────────────────────────────────────────────────────────────┤
│ 01 ──┬─→ 02                                           │
│      ├─→ 03 (parallel with 04,05,06)                    │
│      ├─→ 04                                            │
│      ├─→ 05                                            │
│      └─→ 06                                            │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 2: Core Infrastructure (Parallel)                    │
├─────────────────────────────────────────────────────────────────┤
│ 07 (all depend on 01-06)                                 │
│ 08 ──┬─→ [All Plugin Tasks 11-25]                      │
│ 09   │                                                  │
│ 10   │                                                  │
│      └──────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 3: Plugin Reviews (15 Parallel Tasks)                │
├─────────────────────────────────────────────────────────────────┤
│ 11-25 (all run in parallel)                               │
│       ↓                                                    │
│       [Platform Adapters 26,27 run in parallel]              │
│              ↓                                             │
│           [Task 28 - Final Integration]                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Review Focus Areas per Task Type

### Core Modules
- **Database**: Connection pooling, SQL injection, query optimization, transactions
- **Event Bus**: Memory leaks, listener cleanup, performance
- **Config**: Token storage, access control, default values
- **LLM Client**: API key security, rate limiting, retry logic
- **Embedders**: Resource usage, memory management, error handling
- **Loaders**: Plugin discovery, error handling, lifecycle management
- **CLI**: Argument parsing, validation, user messages

### Message Handlers
- **Security**: Access control, role handling, data privacy
- **Performance**: Impact on all messages (logger), file cleanup
- **Best Practices**: Event bus usage, error handling
- **Conventions**: Simple plugin IDs, normalized API

### Slash Commands
- **Security**: User data access control, opt-out handling
- **API**: Command registration, autocomplete, interactions
- **Validation**: Input validation, error handling
- **User Experience**: Ephemeral responses, buttons, modals

### AI Tools
- **Security**: API key handling, external service validation
- **Validation**: Tool schema, parameter validation
- **Error Handling**: Retry logic, graceful failures
- **Performance**: Caching, rate limiting

### Platform Adapters
- **Event Translation**: Platform events → normalized format
- **Access Control**: Verification before event emission
- **Command Registration**: Platform-specific registration
- **Interactions**: Buttons, selects, modals, embeds

---

## Progress Tracking

### Quick Status Check

```bash
# See all active tasks
ls .tmp/tasks/

# Check review progress
cd .tmp/tasks/comprehensive-plugin-code-review/
grep -h '"status":' subtask_*.json | sort | uniq -c

# Count completed tasks
grep -l '"status": "completed"' subtask_*.json | wc -l
```

### Task Status Flow

```
pending → in_progress → completed
   ↑            ↓
   └──── blocked ─┘
```

### Verification Process

After each task completion:

1. **Agent signals completion**
2. **TaskManager checks acceptance criteria**
3. **If all pass**: Mark as completed via CLI
4. **If any fail**: Keep in_progress, report failures

---

## Acceptance Criteria Template

Each subtask includes binary acceptance criteria:

- ✅ **Specific and measurable**: "SQL injection vulnerabilities checked"
- ✅ **Binary pass/fail**: Can be verified as yes/no
- ✅ **Actionable**: Leads to specific deliverables

Example:
```
- Database queries reviewed for SQL injection risks
- Query optimization and index usage verified
- Error handling and transaction management checked
- Any issues documented with severity and location
```

---

## Deliverables

Per subtask:
- Review report documenting findings
- Issues categorized by severity (critical, high, medium, low)
- Specific file locations and line numbers for each issue

Final task:
- Comprehensive review report consolidating all findings
- Prioritized issue list with recommendations
- Security vulnerabilities flagged separately
- Convention violations cataloged
- Performance improvement suggestions

---

## Execution Order Summary

### Sequential Groups
1. **Group A**: 01 → 02, 03, 04, 05, 06 (after 01)
2. **Group B**: 07, 08, 09, 10 (after Group A)
3. **Group C**: 11-25 (after Group B) ← **Largest parallelization**
4. **Group D**: 26, 27 (after Group C)
5. **Group E**: 28 (after Group D)

### Critical Path
```
01 → 02 → 07 → [11-25] → 26 → 28
         ↘    ↓              ↗
          → 08 → [11-25] → 27
          → 09
          → 10
```

**Minimum sequential tasks**: 6 (01, 02, one of 07-10, one of 11-25, one of 26-27, 28)
**Maximum parallel tasks**: 15 (all of 11-25 can run simultaneously)

---

## Key Findings from Architecture Analysis

### Plugin Statistics
- **Total Plugins**: 22
  - Message handlers: 3
  - Slash commands: 7
  - Timers: 1
  - AI tools: 11
- **CLI Commands**: 6
- **Core Modules**: 27 files
- **Platform Adapters**: 2 (Discord, Slack)

### Security-Critical Plugins
1. MemorySlashPlugin (user preferences)
2. WebSearchTool (API keys, search queries)
3. ImageGenerationTool (API keys, prompts)
4. UrlReaderTool (SSRF prevention)
5. KnowledgeSearchTool (guild access control)
6. ProfileCommandPlugin (user privacy)
7. ReminderTimerPlugin (DM delivery)
8. LoggerPlugin (all messages)
9. MediaAutoPlugin (file downloads)
10. AIPlugin (tool access control, prompt injection)

### Shared Dependencies
- **EventBus**: Central communication hub
- **Database**: Direct access pattern (no service layer)
- **Config**: Tokens and access control
- **LLMClient**: Shared across multiple plugins
- **User Lookup**: Universal dependency

---

## Getting Started

### Next Available Tasks

```bash
# Tasks ready to start (no dependencies)
01, 03, 04, 05, 06

# After 01 completes
02

# After 01-06 complete
07, 08, 09, 10

# After 07-10 complete
11-25 (all ready)

# After plugin reviews complete
26, 27

# Final task
28 (after 26, 27)
```

### Running Tasks with CodeReviewer Agent

For each subtask:

```bash
# Load subtask JSON
cat .tmp/tasks/comprehensive-plugin-code-review/subtask_NN.json

# Execute review with CodeReviewer agent
task(subagent_type="CodeReviewer", prompt="Review files specified in subtask_NN.json")

# After agent completes, verify acceptance criteria
# Mark as completed if all pass
```

---

## File Structure

```
.tmp/tasks/comprehensive-plugin-code-review/
├── task.json              # Feature metadata
├── subtask_01.json       # Database client
├── subtask_02.json       # Database repositories
├── subtask_03.json       # Event bus
├── subtask_04.json       # Config
├── subtask_05.json       # LLM client
├── subtask_06.json       # Embedders
├── subtask_07.json       # Plugin loader
├── subtask_08.json       # Tool loader
├── subtask_09.json       # Command registry
├── subtask_10.json       # CLI framework
├── subtask_11.json       # Logger plugin
├── subtask_12.json       # Immich auto plugin
├── subtask_13.json       # Media auto plugin
├── subtask_14.json       # Memory slash command
├── subtask_15.json       # Profile slash command
├── subtask_16.json       # Media slash command
├── subtask_17.json       # Imagine slash command
├── subtask_18.json       # About slash command
├── subtask_19.json       # Reminder slash command
├── subtask_20.json       # Knowledge slash command
├── subtask_21.json       # All AI tools
├── subtask_22.json       # AI plugin & services
├── subtask_23.json       # Reminder timer
├── subtask_24.json       # All CLI commands
├── subtask_25.json       # Stream plugin
├── subtask_26.json       # Discord adapter
├── subtask_27.json       # Slack adapter
└── subtask_28.json       # Cross-plugin integration
```

---

## Success Metrics

- ✅ All 28 subtasks completed
- ✅ All security issues documented
- ✅ All convention violations cataloged
- ✅ All bugs and performance issues identified
- ✅ Comprehensive review report generated
- ✅ Prioritized recommendations provided

---

## Notes for CodeReviewer Agent

1. **Read subtask JSON first** to understand context files and acceptance criteria
2. **Follow AGENTS.md conventions** when reviewing
3. **Flag security issues separately** with severity levels
4. **Document exact file locations** (file:line) for all issues
5. **Prioritize findings**: Critical > High > Medium > Low
6. **Provide actionable recommendations** for each issue
7. **Return structured report** that can be compiled later

---

**Created**: 2026-01-29
**Last Updated**: 2026-01-29
