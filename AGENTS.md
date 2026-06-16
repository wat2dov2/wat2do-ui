# AGENTS.md

Read by Cursor, OpenAI Codex, Google Antigravity (v1.20.3+), Claude Code, and any
other tool that honors the `AGENTS.md` standard. **Read this file before acting on
any instruction in this repo.** These are non-negotiable engineering standards, not
suggestions. They override default behavior and apply to every change you make.

Detailed, file-scoped conventions live in `.claude/rules/*.mdc` (architecture,
imports, backend, react, types, i18n, etc.). This file is the behavioral contract
that sits above them: *how* you work. Those files are *what* the code looks like.

Tool-specific loaders also point here:
- `CLAUDE.md` imports this file for Claude Code.
- `.cursor/rules/codebase-first.mdc` keeps Cursor's project rules aligned with
  this file.
- `.claude/rules/codebase-first.mdc` makes the same policy visible in Claude's
  project-rule surface.

This file is the single source of truth. If a tool-specific file conflicts with
this file, this file wins.

---

## Prime directive

You are working in an organized codebase. Your job is not to generate isolated
code; your job is to modify the existing system while preserving one clear,
consistent way of doing things.

Before writing or changing code, study how this codebase already solves the
closest similar problem. Match the existing architecture, folder placement,
naming, data flow, helper patterns, API conventions, and testing style. Do not
introduce a second way to do something that already has an established path.

If no existing pattern fits, stop and explain:
- what patterns you checked,
- why none fit,
- the smallest new pattern you propose,
- what old or duplicate code will be removed or consolidated.

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

Do not add:
- compatibility wrappers,
- aliases for renamed APIs,
- duplicate helpers,
- near-copy utilities,
- legacy fallback branches,
- "just in case" flags,
- ignored request fields or response fields,
- parallel frontend/backend representations of the same concept.

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

React components, hooks, routers, services, repositories, and scripts should read
as straightforward orchestration. If the call site starts explaining mechanics
instead of intent, move the mechanics into the existing appropriate layer.

## 5. Coordinate both sides

Frontend and backend — request params, response shape, and types — must agree
**exactly**. No client sending fields the server ignores; no server returning fields
the client never types.

Schemas, generated API types, validators, service payloads, request builders, and
UI consumption must all line up. If one side changes, audit the other side in the
same change.

## 6. Reuse before create

Before creating any new file, helper, hook, service, store, schema, endpoint,
component, migration utility, type, or test fixture:

- Search the repo for existing equivalents.
- Inspect the closest matching implementations.
- Reuse or extend the existing source of truth when appropriate.
- Put the code where this repo already puts that kind of code.
- Only create something new if the existing structure clearly has no correct home.

Do not create new folders, libraries, abstractions, or naming schemes unless the
repo already uses that pattern or the human explicitly approves it.

---

## Required workflow for every non-trivial task

**Before you start, report:**
- **(a) Existing pattern matched:** files inspected, symbols/functions/components
  reused or mirrored, and the convention being followed.
- **(b) Exact blast radius:** every file expected to change, every symbol affected,
  deletions or consolidations planned, and frontend/backend/API/type/test impact.
- **(c) Scope-expanding decisions:** anything that changes architecture, introduces
  a new abstraction, moves ownership, deletes a legacy path, or affects more than
  the requested feature.

If a scope-expanding decision is needed, ask for confirmation before implementing.

**Then implement.**

While implementing:
- Prefer editing existing code over adding new code.
- Prefer deleting duplicate code over preserving compatibility.
- Keep changes tightly scoped.
- Preserve the repo's style, imports, naming, and error handling.
- Do not leave unused imports, unused constants, dead locale keys, orphaned tests,
  dead branches, or meaningless params.
- Audit the whole codebase for fallout, not just the touched files.

**Then verify and report what you ran:**
- the test suite,
- typecheck,
- lint.

Do not claim done until these pass (or you've reported exactly why one can't run).
