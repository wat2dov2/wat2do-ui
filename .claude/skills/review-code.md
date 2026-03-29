---
name: review-code
description: Use this when the user asks to "review," "check," "audit," or "look over" code changes. Reviews staged/unstaged git changes for quality, bugs, security, and orphaned code.
context: fork
allowed-tools: Read, Glob, Grep, Bash
---

# Review Code

You are reviewing code in the wat2do-v2 platform. Run in a forked context to keep the main conversation clean.

## Review Process

### Step 1: Get the diff
```bash
git diff              # unstaged changes
git diff --cached     # staged changes
git diff HEAD~1       # last commit (if already committed)
```

### Step 2: Check each change against criteria

#### Correctness
- Does the logic match the intent?
- Are edge cases handled at system boundaries (user input, API responses)?
- Are async operations properly awaited?

#### Security (OWASP Top 10)
- No raw SQL or string interpolation in queries
- No user input rendered without sanitization (XSS)
- No secrets or tokens hardcoded
- Auth checks on protected routes (both frontend guards and backend middleware)
- Supabase RLS not bypassed accidentally (service role client vs regular client)

#### Frontend-Specific
- No unnecessary re-renders (missing deps in useEffect, unstable references)
- Proper TypeScript types (no `any` unless justified)
- Consistent use of `@/` path alias
- Tailwind classes follow the corkboard design system
- All user-visible strings use `t()` from useTranslation

#### Backend-Specific
- Pydantic schemas validate all request data
- Proper HTTP status codes
- Services are sync (not async) — matches project convention
- Error responses follow consistent format

### Step 3: Orphaned Code Detection (critical)

For every function, component, type, variable, import, or export that was **deleted or renamed** in the diff:

1. **Extract the name** of anything removed or renamed
2. **Grep the entire codebase** for each one:
   ```bash
   # For each deleted/renamed symbol:
   rg "deletedFunctionName" --type ts --type tsx --type py -l
   rg "RenamedComponent" --type ts --type tsx -l
   rg "old_service_function" --type py -l
   ```
3. **Flag orphans** — references that still point to the old name:
   - Import statements pulling a deleted export
   - Components rendering a removed component
   - API calls to a renamed/removed endpoint
   - Type references to a deleted interface
   - Test files testing a function that no longer exists
   - Route registrations pointing to removed handlers

4. **Check the reverse too** — for any NEW function/component added, grep to confirm it's actually used somewhere. Flag dead code on arrival.

5. **Check barrel exports** — if a file was deleted or a component renamed, check the feature's `index.ts` for stale re-exports:
   ```bash
   rg "from.*deletedFile" frontend/src/ -l
   ```

### Step 4: Contract consistency

If backend schemas changed:
```bash
# Check if frontend types still match
rg "fieldNameFromDiff" frontend/src/shared/types/ frontend/src/features/ -l
```

If frontend types changed:
```bash
# Check if API calls still send the right shape
rg "apiClient\.(post|patch|put)" frontend/src/ -l -A 5
```

## Output Format

Present findings as:

- **Critical** — bugs, security issues, or broken references that WILL cause runtime errors
- **Orphan** — dead imports, stale references, unused code left behind by the change
- **Suggestion** — improvements worth considering
- **Nit** — minor style/preference items

For each orphan found, include the exact file path, line, and the grep match so the user can fix it immediately.

## Constraints

- Never modify files during review — only report findings
- Never suggest adding comments, docstrings, or type annotations to unchanged code
- Always run the orphan detection greps — this is not optional
- Always check barrel exports (index.ts files) when components are added/removed/renamed
- Start immediately with findings — no preamble like "I'll review the code"
