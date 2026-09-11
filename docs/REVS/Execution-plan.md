---
name: ai-planner
description: >
  Generate dense, implementation-ready execution plans optimized for AI-to-AI coding.
  Reads tasks from a file or pasted text, interviews the user per task (grill-me) to clarify requirements,
  searches the codebase to locate affected files, and outputs a highly structured plan compatible with strict-execution.
  Saves to E:\Ideas\UI\UI\docs\execution\Execution-[original-name].md (or Execution-plan[-N].md).
  Use when user says "/ai-planner", "/ai-plan", "ai plan", "plano para sa ai", "gawan mo ng plan".
---

# AI Planner Skill

Generate a dense, boilerplate-free execution plan optimized for AI-to-AI coding. The plan must be compatible with the `/strict-execution` skill.

---

## 1. Input Processing & Execution Directory

The skill accepts tasks in two formats:
- **File path** to a `.md` file (e.g. `E:\Ideas\UI\UI\docs\goal\implementation_plan.md`)
- **Pasted text** in the chat window

**Output Location:**
ALWAYS save the generated plan in `E:\Ideas\UI\UI\docs\execution\`

**Output Filename Rule:**
- **If file path provided:** `Execution-[Original Filename].md` (e.g., `Execution-implementation_plan.md`)
- **If pasted text:** `Execution-plan.md`. If a file with that name already exists in the directory, append an incrementing number (e.g., `Execution-plan-1.md`, `Execution-plan-2.md`).

---

## 1.5. Grill-Me Phase per Task (Interactive Interview)

Before running search queries or generating the execution checklist for any task, you must:
1. **Analyze the current task** to identify potential ambiguities, design choices, edge cases, or missing information.
2. **Interview the user (Grill-Me)**: Ask the user 1-3 targeted questions to clarify the requirements for this specific task.
3. **Process one by one**: If there are multiple tasks, do not ask about all of them at once. Ask questions for **Task 1 first**, get the answers, write the finalized plan block for Task 1, and then move to **Task 2's Grill-Me interview**.
4. **Wait for confirmation**: Wait for the user's answers and approval before starting the proactive codebase search for that task.

---

## 2. Research & Codebase Mapping (Proactive Search)

After the Grill-Me phase for a task is completed and approved:
1. Use grep, file search, and list commands to search the active codebase (`E:\Ideas\UI\UI`).
2. Identify the **exact and correct file paths** that need to be modified or created to complete the task.
3. NEVER guess file paths. Always locate them in the directory structure.

---

## 3. Output Format

For every task, write a highly structured block matching the format below.

### Task Format Definition

```markdown
## TASK-[ID]: [Task Name]

**Task ID:** [ID] | **Priority:** [Priority Level (🔴 Critical / 🟠 Medium / 🟡 Low)]
**Task Status:** `[ ]` Not Started

**Objective:**
[1-2 sentences summarizing the goal of this task]

**Affected Files:**
```
[MODIFY] app/src/main/java/.../ExactPathToFile.kt
[CREATE] app/src/main/java/.../NewFile.kt
```

**Implementation Checklist:**
- [ ] [Concise step description]
  ```[language]
  // Dense boilerplate-free logic, exact class/variable names, and logic flows.
  // NO verbose code, NO full file imports, NO large boilerplates.
  // Write in a way that is optimized for another AI to read and write.
  ```
- [ ] [Next step description]
  ```[language]
  // Logic instructions for next step...
  ```
```

---

## 4. Master Checklist (File Footer)

At the end of the execution file, generate a Master Checklist table summarizing all tasks in the plan:

```markdown
## Master Checklist — All Tasks

| ID | Task | Priority | Status |
|---|---|---|---|
| **[ID]** | [Task Name] | [Priority] | `[ ]` Not Started |
```

---

## 5. Implementation Notes

- **AI-to-AI Optimization:** The suggestions under checklist items must be dense. Write code blocks containing pseudocode or logical flows. The goal is to maximize clarity for another AI while minimizing context tokens (e.g. outline logical branches, loop bounds, API invocations, but omit boilerplate getters, overrides, or layout XML details unless crucial).
- **Absolute Paths:** When specifying files under **Affected Files**, use relative paths from the project root or clean exact relative paths so `/strict-execution` can map them easily.
