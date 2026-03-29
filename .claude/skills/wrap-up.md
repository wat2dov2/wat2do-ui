---
name: wrap-up
description: Use this at the end of every session to summarize progress, extract new rules, and update project documentation like CLAUDE.md and claude skills.
---

# Wrap-Up Protocol

When this skill is activated, perform the following steps in order:

### 1. Executive Summary
- Provide a 3-bullet summary of exactly what was accomplished in this session.
- List any "Open Loops" (tasks started but not finished).

### 2. Knowledge Extraction
- Identify any **preferences** the user expressed (e.g., "I prefer functional components over classes").
- Identify any **architectural decisions** made (e.g., "We decided to use SQLite for the local cache").
- Note any **bug patterns** we encountered and how we fixed them.

### 3. Documentation Update (The "Memory" Step)
- Read the existing `CLAUDE.md` file.
- Propose specific additions to the `## Guidelines` or `## Patterns` sections based on this session's learnings.
- **Action:** Ask the user: "Should I update CLAUDE.md with these new rules?"

### 4. Next Session "Save State"
- Write a one-sentence "Next Step" that the user can paste into the next chat to get started immediately without re-explaining everything.