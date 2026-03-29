---
name: write-test
description: Use this when the user asks to "write a test," "add tests," "add coverage," or "test this." Writes Playwright E2E tests for frontend or pytest tests for backend.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Agent
---

# Write Test

You are writing tests for the wat2do-v2 platform.

## Frontend Tests (Playwright E2E)

1. Add tests in `frontend/e2e/` directory
2. Use Playwright test syntax (`test`, `expect`, `page`)
3. Base URL is `http://localhost:5173`
4. Reference existing patterns in `frontend/e2e/integration.spec.ts`
5. Use data-testid attributes for selectors when available
6. Take screenshots on failure (configured in `playwright.config.ts`)

Example structure:
```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test('should do something', async ({ page }) => {
    await page.goto('/route');
    await expect(page.getByTestId('element')).toBeVisible();
  });
});
```

## Backend Tests (pytest)

1. Add tests in `backend/tests/routers/` or `backend/tests/services/`
2. Use pytest-asyncio for async tests (`@pytest.mark.asyncio`)
3. Reference fixtures in `backend/tests/conftest.py`
4. Mock Supabase client calls — do NOT hit real database in unit tests
5. Test both success and error paths

Example structure:
```python
import pytest

@pytest.mark.asyncio
async def test_something(client):
    response = await client.get("/endpoint")
    assert response.status_code == 200
```

## Constraints

- Never modify production code while writing tests (unless adding data-testid attributes)
- Never skip or disable existing tests
- Start immediately with the test code — no preamble
