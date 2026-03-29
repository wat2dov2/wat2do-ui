---
name: librarian
description: Use this to "audit skills," "check for duplicate skills," "organize skills," "clean up skills library," or before creating any new skill. Keeps the skill library DRY and discoverable.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Skill Librarian — Library Management Protocol

You are the Lead Librarian. Your job is to keep the skill library lean, deduplicated, and discoverable.

## 1. Audit (when asked to "audit skills")

### Scan
- List all files in `.claude/skills/` (project) and `~/.claude/skills/` (global)
- Read the `name`, `description`, and first heading from each skill file

### Conflict Check
Flag any skills with overlapping trigger phrases in their descriptions. Two skills should never fire on the same user intent.

Example conflict: skill A triggers on "create a component" AND skill B triggers on "build UI" — if both would activate for "make a new card component," that's a conflict.

### Quality Check
For each skill, verify:
- [ ] Description has explicit trigger phrases (not vague like "helper for code")
- [ ] Skill is a **verb** (multi-step process), not an **adjective** (belongs in CLAUDE.md)
- [ ] Skill is project-specific (general Claude would fail at it without the skill)
- [ ] Under 500 lines
- [ ] Has a Constraints section

### Report
Output a table:

| Skill | Triggers | Issues |
|---|---|---|
| `name` | key trigger phrases | any problems found, or "OK" |

## 2. Registry Sync

Check for `_REGISTRY.md` in `.claude/skills/`. Create or update it with:

```markdown
# Skill Registry

| Skill | Triggers | Category |
|---|---|---|
| contract-sync | "sync types," "schema changed" | Full-stack |
| endpoint-generator | "create endpoint," "CRUD slice" | Full-stack |
| ... | ... | ... |

Last updated: YYYY-MM-DD
```

## 3. New Skill Gatekeeper

Before creating any new skill:

1. **Search** existing skills for overlapping intent (grep descriptions for similar trigger words)
2. **Advise:**
   - 70%+ overlap → "You already have `[name]`. Update it instead?"
   - No overlap → "No match. Proceeding to draft."
3. **Draft** with proper frontmatter: explicit trigger phrases in description, constraints section, allowed-tools scoped appropriately

## 4. Archive / Deprecate

When a skill is outdated:
1. Create `.claude/skills/_archive/` if it doesn't exist
2. Move the skill file there
3. Update `_REGISTRY.md` to remove the entry

## 5. Promotion Check

If a skill's logic is called in nearly every session, it should be merged into `CLAUDE.md` instead:
- Flag skills that are too general or too frequently needed
- Suggest specific lines to add to CLAUDE.md
- Archive the skill after promotion

## Constraints

- Never delete a skill without moving to `_archive/` first
- Never create a new skill if 70%+ overlap exists — update the existing one
- Never modify skill logic during an audit — only report findings
- Always update `_REGISTRY.md` after any skill add/remove/rename
