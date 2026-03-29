---
name: db-migrate
description: Use this when the user asks to "add a table," "add a column," "change the schema," "create a migration," "update the database," or "database change." Checks models, writes migration, verifies correctness before applying.
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---

# Database Migration Expert

You are making database schema changes for wat2do-v2's Supabase PostgreSQL database. This is a safety-critical workflow — verify before applying.

## Architecture Context

- Database: Supabase PostgreSQL
- Queries: Supabase SDK only (`get_sb().table("name")`) — NO SQLAlchemy for queries
- Models: `backend/models/` defines the schema shape for Alembic
- Migrations: Alembic in `backend/migrations/versions/`
- Config: `backend/alembic.ini` (uses `database_url` from settings — legacy connection)

## Step-by-Step Process

### 1. Read current state
```bash
# Check existing models
ls backend/models/
# Check latest migration
ls -t backend/migrations/versions/ | head -5
```
Read the relevant model file and the latest migration to understand current schema.

### 2. Write the model change

Edit the model in `backend/models/`. Follow existing patterns:
- Use SQLAlchemy column types for Alembic compatibility
- New columns that add to existing tables MUST be `nullable=True` or have a `server_default`
- New boolean columns: always `server_default=text("false")`
- New string columns with no natural default: `nullable=True`

### 3. Update Pydantic schemas

Edit `backend/schemas/` to match:
- Add field to `*Response` model (always)
- Add field to `*Create` model (if user provides it at creation)
- Add field to `*Update` model as optional (if user can edit it)

### 4. Generate the migration
```bash
cd /Users/tqiu/test/backend && .venv/bin/alembic revision --autogenerate -m "add [description]"
```

### 5. VERIFY the generated migration (critical step)

Read the generated file and check:
- [ ] Correct table name?
- [ ] Correct column type?
- [ ] Nullable set correctly? (new columns on existing tables should be nullable or have defaults)
- [ ] `downgrade()` function reverses the change properly?
- [ ] No unintended changes detected by autogenerate? (Alembic sometimes picks up phantom diffs)

Show the user the migration content and ask for confirmation.

### 6. Apply (only after user confirms)
```bash
cd /Users/tqiu/test/backend && .venv/bin/alembic upgrade head
```

### 7. Update the service layer

If the new column needs to be queryable, update `backend/services/` to include it in Supabase queries.

## Common Pitfalls

| Mistake | Fix |
|---|---|
| Non-nullable column on existing table | Alembic will fail if rows exist. Use `nullable=True` or `server_default` |
| Forgetting RLS policy | New tables need RLS policies in Supabase dashboard or SQL |
| Editing old migration files | Never. Always create new migration |
| UUID columns | Use `sa.dialects.postgresql.UUID(as_uuid=True)` |
| Enum columns | Use `sa.String` and validate in Pydantic, not DB enum |

## Constraints

- Never apply migrations without showing the user the generated file first
- Never drop tables or columns without explicit user confirmation
- Never modify existing migration files — always create new ones
- Never add non-nullable columns to existing tables without a default value
- Always update Pydantic schemas to match model changes
- Start immediately — no preamble
