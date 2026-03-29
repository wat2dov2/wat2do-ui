---
name: localize
description: Use this when the user asks to "add translations," "localize," "add i18n keys," "translate this feature," "add a new language," or "internationalize." Handles translation keys, locale files, and language configuration.
allowed-tools: Read, Edit, Write, Glob, Grep
---

# Localize — i18n Translation Management

You are adding or updating translations in the wat2do-v2 i18n system.

## Architecture

- Library: `react-i18next`
- Locale files: `frontend/src/locales/{lang}.json` (currently only `en.json`)
- Config: `frontend/src/shared/lib/i18n.ts`
- Language loading: `frontend/src/shared/lib/loadLanguage.ts` (dynamic imports)
- Language persistence: `frontend/src/features/settings/api/settings.api.ts` (localStorage key: `i18n-language`)
- Language list: `frontend/src/shared/constants/languages.ts`

## Adding Translation Keys (most common task)

### Step 1: Identify the correct section in `en.json`

Top-level sections and when to use them:

| Section | Use for |
|---|---|
| `common` | Reusable: "Save", "Cancel", "Loading", "Yes", "No" |
| `navigation` | Nav items: "Events", "Settings", "About" |
| `forms` | Form labels/validation: "Title is required", "Pick a date" |
| `events` | Event feature: "Create Event", "Event Title" |
| `clubs` | Club feature: "Create Club", "Club Members" |
| `admin` | Admin panel strings |
| `settings` | Settings page (nested: `settings.profile`, `settings.notifications`, etc.) |
| `filters` | Filter UI: "Category", "Price", "Location" |
| `commands` | Command palette items |
| `qrCode` | QR/poster feature |
| `clubPanel` | Club panel interface |
| `integrations` | Platform integrations (Discord, Slack, etc.) |
| `modals` | Modal dialogs |
| `onboarding` | Onboarding flow |
| `categories` | Event category names |
| `locations` | Location names |
| `foods` | Food type names |
| `calendar` | Month/day names |
| `marketing` | Marketing pages |
| `about` | About page |
| `search` | Search UI |
| `credits` | Credits/payment |

### Step 2: Add keys following naming conventions

```json
{
  "myFeature": {
    "title": "My Feature",
    "description": "A description of my feature",
    "createButton": "Create New Item",
    "deleteConfirm": "Are you sure you want to delete this?",
    "successMessage": "{{name}} has been created successfully!",
    "itemCount": "{{count}} item",
    "itemCount_other": "{{count}} items"
  }
}
```

**Key naming rules:**
- camelCase for keys: `"eventTitle"` not `"event-title"` or `"EventTitle"`
- Actions: verb + noun: `"createEvent"`, `"deleteClub"`
- Messages with variables: `"*Message"` suffix with `{{variable}}` interpolation
- Validation: `"*Required"`, `"*Invalid"` suffix
- Plurals: `"key"` for singular, `"key_other"` for plural

### Step 3: Use in components

```typescript
import { useTranslation } from "react-i18next";

function MyComponent() {
  const { t } = useTranslation();

  return (
    <div>
      <h1>{t("myFeature.title")}</h1>
      <p>{t("myFeature.successMessage", { name: item.name })}</p>
      <p>{t("myFeature.itemCount", { count: items.length })}</p>
    </div>
  );
}
```

## Adding a New Language

### Step 1: Create locale file
Copy `en.json` to `frontend/src/locales/{lang}.json` and translate all values.

### Step 2: Register the language
Edit `frontend/src/shared/constants/languages.ts`:
```typescript
export const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'en', label: 'English', flag: '🇨🇦' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },  // Add new language
];

export const LANGUAGE_CODES = ['en', 'fr'];  // Add code
```

### Step 3: Update type
Edit `frontend/src/features/settings/api/settings.api.ts`:
```typescript
const SUPPORTED_LANGUAGES = ['en', 'fr'] as const;  // Add code
```

No changes needed to `i18n.ts` or `loadLanguage.ts` — they handle new languages dynamically via `import(`@/locales/${lang}.json`)`.

## Constraints

- Never hardcode user-visible strings in components — always add to `en.json` and use `t()`
- Never nest keys deeper than 3 levels — keep it flat within sections
- Never duplicate keys across sections — use `common` for shared strings
- Never modify the i18n config or loadLanguage logic for adding keys
- If a missing key appears in the UI as a raw key string (e.g., "myFeature.title"), that means the key doesn't exist in en.json yet — add it
- Start immediately with the changes — no preamble
