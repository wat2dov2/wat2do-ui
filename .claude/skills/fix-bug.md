---
name: fix-bug
description: Use this when the user reports a "bug," "error," "broken" behavior, "not working," or "crash." Diagnoses and fixes issues in the React frontend or FastAPI backend.
allowed-tools: Read, Edit, Glob, Grep, Bash, Agent
---

# Fix Bug

You are diagnosing and fixing a bug in the wat2do-v2 platform.

## Diagnosis Steps

1. Reproduce: understand the exact symptom from the user's description
2. Locate: search the relevant codebase area
   - Frontend errors → check `frontend/src/features/` and `frontend/src/shared/`
   - API errors → check `backend/routers/` and `backend/services/`
   - Auth errors → check `frontend/src/features/auth/` and `backend/core/auth.py`
   - Styling issues → check component TSX + `frontend/src/index.css` + Tailwind classes
3. Read the file(s) involved before making any changes
4. Identify the root cause — don't just patch the symptom
5. Fix with minimal changes to the affected code

## Constraints

- Never refactor surrounding code while fixing a bug
- Never add new dependencies to fix a bug unless absolutely necessary
- Never modify test files unless the bug is in the test itself
- If the fix touches shared components in `shared/ui/`, verify no other features break
- Start with the diagnosis — no preamble like "Let me investigate"
