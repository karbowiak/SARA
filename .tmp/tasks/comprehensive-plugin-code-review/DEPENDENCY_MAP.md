# Dependency Map & Parallel Execution Guide

## Execution Flow Visualization

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PHASE 1: CORE FOUNDATION                        │
│  (Sequential + Parallel)                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   01 ──┬─→ 02 ──┐                                                      │
│         │          │                                                      │
│         ├─→ 03    │                                                      │
│   (all    ├─→ 04    │                                                      │
│    can   ├─→ 05    ↓                                                      │
│   run   └─→ 06 ────────────────→  PHASE 2 ─→  PHASE 3 ─→ PHASE 4 → 28 │
│   parallel after 01)                                                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                      PHASE 2: CORE INFRASTRUCTURE                        │
│  (All Parallel - can run simultaneously)                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────┬──────┬──────┬──────┐                                     │
│   │  07  │  08  │  09  │  10  │                                     │
│   └──┬───┴──┬───┴──┬───┴──┬───┘                                     │
│      │       │       │       │                                         │
│      └───────┴───────┴───────┘                                         │
│              ↓                                                         │
│              [All depend on 01-06]                                      │
│              ↓                                                         │
│         ┌─────────────────┐                                             │
│         │  TRIGGER        │                                             │
│         │  PHASE 3       │                                             │
│         └─────────────────┘                                             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 3: PLUGIN REVIEWS                                │
│  (15 Parallel Tasks - BIGGEST PARALLELIZATION OPPORTUNITY)                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────────────────────────────────────────────────────────────┐   │
│   │  11  12  13  │  14  15  16  17  18  19  20  │  21  22  23  │   │
│   │ (Message)    │ (Slash Commands - 7 tasks)       │ (AI,Timer)    │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
│                              │                                           │
│                              ↓                                           │
│                         ┌──────────┐                                     │
│                         │   24 25  │ (CLI, Stream - can run parallel)   │
│                         └──────────┘                                     │
│                              ↓                                           │
│                         ┌─────────────────┐                               │
│                         │  TRIGGER        │                               │
│                         │  PHASE 4       │                               │
│                         └─────────────────┘                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 4: PLATFORM ADAPTERS                              │
│  (2 Parallel Tasks)                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌───────┬───────┐                                                    │
│   │  26   │  27   │                                                    │
│   │ Discord│ Slack │                                                    │
│   └───┬───┴───┬───┘                                                    │
│       │       │                                                         │
│       └───────┘                                                         │
│           ↓                                                              │
│        ┌──────┐                                                          │
│        │  28  │  ← FINAL INTEGRATION REVIEW                               │
│        └──────┘                                                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Parallel Execution Matrix

| Phase | Tasks | Parallel? | Can Run With |
|-------|-------|------------|--------------|
| **1A** | 01 | No (first) | - |
| **1B** | 03,04,05,06 | Yes | Each other (after 01) |
| **1C** | 02 | No | After 01 |
| **2** | 07,08,09,10 | Yes | Each other (after 1) |
| **3A** | 11-20 | Yes | Each other (after 2) |
| **3B** | 21-23 | Yes | Each other & 11-20 (after 2) |
| **3C** | 24,25 | Yes | Each other & above (after 2) |
| **4** | 26,27 | Yes | Each other (after 3) |
| **5** | 28 | No (last) | After all |

---

## Optimal Parallelization Strategy

### Strategy A: Maximum Parallelism (Fastest)

```bash
# Step 1: Start with 01
CodeReviewer → Task 01

# Step 2: After 01 completes, launch 4 parallel tasks
CodeReviewer → Task 03
CodeReviewer → Task 04
CodeReviewer → Task 05
CodeReviewer → Task 06

# Step 3: After 02 completes, launch Phase 2 (4 parallel)
CodeReviewer → Task 07
CodeReviewer → Task 08
CodeReviewer → Task 09
CodeReviewer → Task 10

# Step 4: After Phase 2, launch MASSIVE parallel (15 tasks!)
CodeReviewer → Tasks 11-25 (all at once)

# Step 5: After plugins, launch adapters (2 parallel)
CodeReviewer → Task 26
CodeReviewer → Task 27

# Step 6: Final integration
CodeReviewer → Task 28
```

**Total Review Time**: ~8-10 hours (with 15 concurrent reviewers)

### Strategy B: Conservative Parallelism (Balanced)

```bash
# Step 1: Core foundation (sequential + limited parallel)
CodeReviewer → Task 01
CodeReviewer → Task 02
CodeReviewer → Task 03,04,05,06 (2 at a time)

# Step 2: Infrastructure (2 at a time)
CodeReviewer → Task 07,08
CodeReviewer → Task 09,10

# Step 3: Plugins (5 at a time - 3 batches)
CodeReviewer → Tasks 11-15 (Batch 1)
CodeReviewer → Tasks 16-20 (Batch 2)
CodeReviewer → Tasks 21-25 (Batch 3)

# Step 4: Adapters
CodeReviewer → Task 26,27

# Step 5: Final
CodeReviewer → Task 28
```

**Total Review Time**: ~20-24 hours (with 5 concurrent reviewers)

---

## Task Dependencies in Detail

### Core Foundation (01-06)
```
01: None
02: 01
03: None
04: None
05: None
06: None
```
**Ready to start**: Tasks 01, 03, 04, 05, 06

### Core Infrastructure (07-10)
```
07: 01,02,03,04,05,06 (all Phase 1)
08: 01,02,03,04,05,06
09: 01,02,03,04,05,06
10: 01,02,03,04,05,06
```
**Ready to start**: After all of Phase 1 complete

### Plugin Reviews (11-25)
```
11-25: All depend on 07,08,09,10 (Phase 2)
```
**Ready to start**: After Phase 2 complete (15 tasks can run in parallel!)

### Platform Adapters (26-27)
```
26: 11-25 (all plugin reviews)
27: 11-25
```
**Ready to start**: After Phase 3 complete

### Final Integration (28)
```
28: 01-27 (everything else)
```
**Ready to start**: Last task

---

## Critical Path Analysis

### Minimum Sequential Tasks (Must Complete in Order)

```
01 → 02 → 07 → [one of 11-25] → [one of 26-27] → 28
```

**Minimum sequential steps**: 6
**Estimated minimum time**: 6-12 hours (if all others run in parallel)

### Maximum Parallelization Opportunity

**Phase 3** (Tasks 11-25) allows **15 concurrent reviews**

This is where you can achieve maximum speedup by assigning multiple CodeReviewer agents simultaneously.

---

## Quick Start Guide

### For Immediate Execution

```bash
# Check which tasks are ready (no pending dependencies)
cd .tmp/tasks/comprehensive-plugin-code-review/

# Tasks ready NOW (no deps)
- 01 (core/database/client.ts)
- 03 (core/event-bus.ts)
- 04 (core/config.ts)
- 05 (core/llm-client.ts)
- 06 (core/embedder.ts)

# Start with Task 01 first (required foundation)
task(subagent_type="CodeReviewer", prompt="Review core/database/client.ts")
```

### After Task 01 Completes

```bash
# Can now run 02, 03, 04, 05, 06 in parallel
task(subagent_type="CodeReviewer", prompt="Review subtask_02.json")
task(subagent_type="CodeReviewer", prompt="Review subtask_03.json")
task(subagent_type="CodeReviewer", prompt="Review subtask_04.json")
task(subagent_type="CodeReviewer", prompt="Review subtask_05.json")
task(subagent_type="CodeReviewer", prompt="Review subtask_06.json")
```

### After Phase 1 Completes (Tasks 01-06)

```bash
# Launch Phase 2 - 4 parallel tasks
task(subagent_type="CodeReviewer", prompt="Review subtask_07.json")
task(subagent_type="CodeReviewer", prompt="Review subtask_08.json")
task(subagent_type="CodeReviewer", prompt="Review subtask_09.json")
task(subagent_type="CodeReviewer", prompt="Review subtask_10.json")
```

### After Phase 2 Completes (Tasks 07-10)

```bash
# 🚀 MASSIVE PARALLEL LAUNCH - 15 tasks!
for i in {11..25}; do
  task(subagent_type="CodeReviewer", prompt="Review subtask_${i}.json") &
done
```

---

## Dependency Validation

To verify dependencies are correct:

```bash
# Check for circular dependencies
cd .tmp/tasks/comprehensive-plugin-code-review/

for f in subtask_*.json; do
  echo "=== $f ==="
  jq -r '"Task: " + .seq + "\nTitle: " + .title + "\nDeps: " + (.depends_on | join(", "))' "$f"
  echo
done
```

Expected output: No circular dependencies, clear topological order.

---

## Progress Tracking Commands

```bash
# Count tasks by status
cd .tmp/tasks/comprehensive-plugin-code-review/
grep '"status"' subtask_*.json | sort | uniq -c

# Which tasks are ready to start?
for i in {01..28}; do
  deps=$(jq -r '.depends_on | join(" ")' subtask_${i}.json)
  if [ -z "$deps" ]; then
    echo "Task $i: Ready (no deps)"
  fi
done

# Which tasks are blocked?
for i in {01..28}; do
  status=$(jq -r '.status' subtask_${i}.json)
  if [ "$status" = "blocked" ]; then
    echo "Task $i: BLOCKED"
  fi
done
```

---

## File Quick Reference

| Subtask | File(s) | Review Focus | Security Critical |
|---------|----------|--------------|------------------|
| 01 | `core/database/client.ts` | DB foundation, connections | ⚠️ Medium |
| 02 | `core/database/*.ts` | Repositories, SQL | 🔴 High |
| 03 | `core/event-bus.ts` | Events, memory leaks | ⚠️ Medium |
| 04 | `core/config.ts` | Tokens, access control | 🔴 High |
| 05 | `core/llm-client.ts` | API keys, LLM | 🔴 High |
| 06 | `core/embedder.ts` | Embeddings, resources | ⚠️ Medium |
| 07 | `core/plugin-loader.ts` | Plugin discovery | ⚠️ Medium |
| 08 | `core/tool-loader.ts` | Tool discovery, filtering | 🔴 High |
| 09 | `core/command-registry.ts` | Command registration | ⚠️ Medium |
| 10 | `core/cli/*.ts` | CLI framework | ⚠️ Medium |
| 11 | `app/plugins/message/logger.plugin.ts` | All messages | 🔴 High |
| 12 | `app/plugins/message/immich-auto.plugin.ts` | Immich API | ⚠️ Medium |
| 13 | `app/plugins/message/media-auto.plugin.ts` | Media, downloads | ⚠️ Medium |
| 14 | `app/plugins/slash/memory/` | User data | 🔴 High |
| 15 | `app/plugins/slash/profile/` | User privacy | 🔴 High |
| 16 | `app/plugins/slash/media/` | Media URLs | ⚠️ Medium |
| 17 | `app/plugins/slash/imagine/` | Image gen, prompts | 🔴 High |
| 18 | `app/plugins/slash/about/` | Package info | 🟢 Low |
| 19 | `app/plugins/slash/reminder/` | Reminders, DMs | ⚠️ Medium |
| 20 | `app/plugins/slash/knowledge/` | Guild data | 🔴 High |
| 21 | `app/plugins/ai/tools/*.tool.ts` | 11 tools, API keys | 🔴 High |
| 22 | `app/plugins/ai/ai.plugin.ts` | Tool access, prompts | 🔴 High |
| 23 | `app/plugins/timers/reminder.plugin.ts` | DM delivery | ⚠️ Medium |
| 24 | `app/commands/*.command.ts` | CLI commands | ⚠️ Medium |
| 25 | `app/plugins/stream/` | Stream service | ⚠️ Medium |
| 26 | `bot/discord/adapter.ts` | Event translation | 🔴 High |
| 27 | `bot/slack/adapter.ts` | Event translation | 🔴 High |
| 28 | All files | Cross-plugin audit | 🔴 High |

---

**Legend**:
- 🔴 High security risk - requires extra attention
- ⚠️ Medium security risk
- 🟢 Low security risk

---

**Last Updated**: 2026-01-29
