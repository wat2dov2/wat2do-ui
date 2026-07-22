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

## Agent standards

### Writing

- Never use the em dash "—".
  Use plain dash "-" instead.
- When writing commit messages, NEVER auto-add your agent name as co-author.
- Never manually modify `CHANGELOG.md` files or any files that are marked as
  auto-generated.
- When writing or substantially editing long Markdown files, put each full
  sentence on its own line.
  Preserve normal Markdown structure, but avoid wrapping multiple sentences onto
  one physical line.

### Technical decisions

When making technical decisions, do not give much weight to development cost.
Instead, prefer quality, simplicity, robustness, scalability, and long-term
maintainability.

### Bug fixes and testing

When doing bug fixes, always start with reproducing the bug in an E2E setting as
closely aligned with how an end user experiences it.
This makes sure you find the real problem so your fix will actually solve it.

When end-to-end testing a product, be picky about the UI you see and be obsessed
with pixel perfection.
If something clearly looks off, even if it is not directly related to what you are
doing, try to get it fixed along the way.

Apply that same high standard to engineering excellence: lint, test failures, and
test flakiness.
If you see one, even if it is not caused by what you are working on right now,
still get it fixed.

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

## Frontend cleanup mandate

Frontend cleanup means reducing concepts, not moving mess.
Every touched frontend path must end with fewer responsibilities, fewer public exports, fewer hidden side effects, or a clearly documented reason it cannot yet be simplified.

When cleaning frontend code:
- Keep `src/app` route files as thin routing shells that delegate to `src/app/client-routes.tsx`, `src/app/routes/*`, or feature page containers.
- Keep feature page containers as orchestration only: load data, call hooks, choose layout, and pass named props.
- Keep React components presentation-first: render UI, delegate state transitions to colocated hooks or reducers, and delegate domain work to feature API/query helpers.
- Treat TanStack Query as the source of truth for server state and use `src/shared/lib/queryClient.ts` plus `src/shared/lib/queryKeys.ts` for cache ownership.
- Do not mirror server state into Zustand or React context unless a consumer truly needs a client snapshot.
- When a client snapshot is needed, name it as a snapshot and keep writes routed through the query cache or feature API.
- Keep stores for client state, optimistic UI glue, auth/session broadcasts, or persisted preferences only.
- Do not create new fetching hooks, cache keys, browser-storage helpers, or state stores until you have searched for the existing equivalent and either reused it or deleted the duplicate path.
- Keep feature public surfaces small: cross-feature imports should use the feature `index.ts` only for intentional public API, and internal imports should stay inside the owning feature.
- Prefer deleting stale exports, props, wrapper components, unused locale keys, and duplicate helpers over adding new layers.
- Split large hooks/components only along real responsibility boundaries: data fetching, URL state, derived view model, form state, and presentational UI.
- Do not perform cosmetic file shuffling or rename churn unless it removes an implementation path or makes ownership unambiguous.
- Before ending any frontend cleanup, search for old imports and dead exports, run the frontend checks, and report anything still duplicated.

---

## Design system mandate

- Build the design system around semantic tokens (`surface`, `primary`, `foreground`) instead of raw Tailwind colors like `bg-white` or `text-gray-500`, so the UI can be re-themed from one place.
- Separate functional tokens (backgrounds, text, borders, buttons) from decorative tokens (gradients, glows, colorful badges, background orbs) so branding does not leak into core UI code.
- Install shadcn/ui components as a starting point, but treat them as our own source code: customize them, remove unused variants, and evolve them instead of leaving them untouched.
- Organize components into three layers: UI primitives (Button, Input, Card), layout primitives (Container, Stack, FormGrid), and feature components (EventCard, ClubCard).
- Pages should compose existing components rather than restyling them with long `className` strings; if the same styling appears repeatedly, move it into the component itself.
- Create small layout helpers like Container, Stack, FormSection, FormGrid, and FormActions so building pages and forms feels like assembling LEGO rather than rewriting spacing and grid classes.
- Keep component APIs intentionally small by exposing meaningful variants (primary, secondary, ghost) instead of dozens of styling props that try to cover every visual possibility.
- Define interaction tokens such as `surface-hover`, `primary-hover`, and `destructive-hover`; derive them from the base colors (typically by slightly reducing lightness) instead of choosing unrelated hover colors.
- Use a dedicated design system showcase page (or Storybook) to preview every component and variant in one place, making it easy to maintain visual consistency as the system evolves.
- Follow one guiding principle: design decisions should live in tokens and reusable components, while pages focus only on composing layouts and business logic, resulting in a codebase that is easy to maintain, extend, and rebrand.

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

## Pushing to `main`

Any agent landing work on `main` must follow [`PUSH_TO_MAIN.md`](PUSH_TO_MAIN.md)
end-to-end before `git push`. That checklist mirrors CI/CD exactly.
