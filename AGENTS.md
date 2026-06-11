# AGENTS.md

Read by Cursor, OpenAI Codex, Google Antigravity (v1.20.3+), Claude Code, and any
other tool that honors the `AGENTS.md` standard. **Read this file before acting on
any instruction in this repo.** These are non-negotiable engineering standards, not
suggestions. They override default behavior and apply to every change you make.

Detailed, file-scoped conventions live in `.claude/rules/*.mdc` (architecture,
imports, backend, react, types, i18n, etc.). This file is the behavioral contract
that sits above them: *how* you work. Those files are *what* the code looks like.

---

## 0. Match the existing pattern first

Before writing code, study how this codebase already solves the similar problem and
follow that exact pattern. **Do not introduce a second way of doing something that
already has an established approach** (e.g. a new cache/store/lib/util/hook for one
feature when one already exists). If no clean existing pattern fits, **say so and
propose one before implementing** — do not invent silently.

## 1. One path

After your change there must be exactly **one obvious way** this thing is done. No
backwards-compat shims, aliases, dead flags, or "duct tape" kept "just in case." If
you replace something, **delete the old thing** in the same change.

## 2. No duplication

If logic resembles code that already exists, **extract a single shared source of
truth** and route both callers through it — do not rewrite a near-copy. Name it so
its intent is obvious.

## 3. Leave nothing stray

After the change there must be **no dead code, unused imports/constants/locale keys,
orphaned tests, or now-meaningless params** on either side of an API/wire contract.
**Audit the whole codebase for fallout, not just the file you touched.**

## 4. Keep call sites dead-simple

Business logic, routing, and controllers stay simple enough that a new dev reads
them and immediately sees the goal. Push plumbing and complexity **down into
well-named helpers** and out of the call sites.

## 5. Coordinate both sides

Frontend and backend — request params, response shape, and types — must agree
**exactly**. No client sending fields the server ignores; no server returning fields
the client never types.

---

## Required workflow for every non-trivial task

**Before you start, report:**
- **(a)** the existing pattern you're matching,
- **(b)** the exact blast radius — every file/symbol affected, **including deletions**,
- **(c)** any scope-expanding decision for the human to confirm.

**Then implement.**

**Then verify and report what you ran:**
- the test suite,
- typecheck,
- lint.

Do not claim done until these pass (or you've reported exactly why one can't run).
