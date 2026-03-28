# wat2do Design System

## Aesthetic

**Corkboard** — the entire UI sits on a warm cork surface with visible grain texture.
Everything feels pinned, tactile, and handmade, but the actual component code stays minimal and clean.

### Principles

1. **Granularity** — SVG fractal noise overlays and subtle radial gradients give surfaces a natural grain. Cork never looks flat or digital.
2. **Minimalism** — Zero external UI libraries. Every component is a single file, uses only Tailwind + React, and has no runtime dependencies beyond React itself. No state management libraries, no animation frameworks, no icon packs.
3. **Pastel palette** — Soft, muted colors that feel chalky and hand-picked:

| Token     | Hex       | Usage                        |
|-----------|-----------|------------------------------|
| `cream`   | `#FAF9F6` | Paper / polaroid backgrounds |
| `surface` | `#F8F9F4` | Card surfaces                |
| `ink`     | `#2D2D2D` | Primary text                 |
| `coral`   | `#F48C76` | Accents, focus rings         |
| `mustard` | `#F1B457` | Warm highlights, pins        |
| `sage`    | `#A9D18E` | Primary actions, checkmarks  |
| `sky`     | `#92C5F9` | Info, cool accents           |

Neutral backgrounds use warm tans: `#EDE9E2`, `#E3DDD4`, `#D6D0C8`, `#C9C2BA`.

### Typography

- **Headings** — serif (`Georgia` stack). Calm, editorial tone.
- **UI text** — system sans-serif. Small, readable, never shouty.

### Shape language

- Generous border radius (`rounded-2xl` / `rounded-full`) — nothing sharp.
- `ring-1 ring-black/8` for soft edges instead of hard borders.
- Shadows are warm and diffused (`shadow-soft`), never stark drop-shadows.

### Components

All live in `src/components/ui/`. Each file exports one component (or a small family like `Card` / `CardHeader` / `CardContent`). They share:

- A `cn()` class-merge helper (no `clsx` / `tailwind-merge` — just filter + join).
- Corkboard-native colors via Tailwind config tokens.
- Native HTML semantics: `<dialog>`, `<input type="range">`, `role="menu"`, etc.
- No portals, no Radix, no Headless UI.

### Gallery

`npm run dev` renders every component on a single corkboard page with polaroid-style cards, push pins, and doodle balls.
