# Wat2Do Design System Notes

## Design Personality

Wat2Do should feel like a smart campus companion: fast, friendly, visual, and
useful before it feels formal. The app is about finding real things happening
around campus, so the interface should foreground actual event content rather
than decorative marketing surfaces.

The current product language is:

- Clean white or near-black app shell.
- Soft borders and restrained shadows.
- Rounded but not overly bubbly surfaces.
- Bright blue for primary action and active state.
- Pastel category colors for event cards.
- Satoshi typography with clear, compact hierarchy.
- Doodle-like icons and playful event-card textures.
- Dense enough for browsing, but still airy.

The onboarding inspiration screenshots add a useful direction: split-pane
screens, tactile pill choices, large confident headlines, real product trials,
and occasional high-contrast reward moments. Wat2Do should borrow that rhythm,
not copy the exact look.

## Source Of Truth

Implementation source files:

- `frontend/src/styles/design-tokens.css`
- `frontend/src/index.css`
- `frontend/src/shared/ui/button.tsx`
- `frontend/src/shared/ui/card.tsx`
- `frontend/src/shared/ui/badge.tsx`
- `frontend/src/shared/ui/event-card-content.tsx`
- `frontend/src/features/events/components/EventCard.tsx`
- `frontend/src/features/auth/components/PreviewStyleEventCard.tsx`
- `frontend/src/app/AppLayout.tsx`
- `frontend/src/app/TopNav.tsx`

Design work should use these tokens and components first. Add new tokens only
when the existing token set cannot express the design.

## Color System

### Core Light Theme

Use these as the primary app canvas and UI structure:

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `hsl(0 0% 100%)` | Main page background |
| `--foreground` | `hsl(0 0% 9%)` | Primary text |
| `--card` | `var(--background)` | Cards and panels |
| `--secondary` | `hsl(0 0% 95%)` | Subtle fills, hover states |
| `--muted` | `hsl(0 0% 93%)` | Disabled/subtle surfaces |
| `--muted-foreground` | `hsl(0 0% 45%)` | Secondary text |
| `--border` | `hsl(0 0% 92%)` | Dividers and card borders |
| `--primary` | `#0052FF` | Main action, active state, links |

The blue is vivid and product-like. Use it for actions and selected state, not
as a full-page wash.

### Core Dark Theme

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `hsl(0 0% 9%)` | Main dark canvas |
| `--foreground` | `hsl(0 0% 98%)` | Primary text |
| `--card` | `hsl(0 0% 12%)` | Panels and cards |
| `--secondary` | `hsl(0 0% 18%)` | Subtle fills |
| `--muted` | `hsl(0 0% 25%)` | Muted surfaces |
| `--border` | `hsl(0 0% 20%)` | Dividers |
| `--primary` | `#0052FF` | Same brand action blue |

Dark mode should feel crisp and functional. Use high-contrast reward screens
sparingly for onboarding payoff moments.

### Status Colors

| Token | Value | Use |
| --- | --- | --- |
| `--success` | `hsl(142 71% 45%)` | Positive status |
| `--warning` | `hsl(38 92% 50%)` | Warning, urgency, deadlines |
| `--error` | `hsl(0 84% 60%)` | Error, destructive, live badges |
| `--info` | `var(--primary)` | Informational emphasis |

### Event Category Palette

Event cards use category-specific pastel backgrounds with saturated text. This
is one of the strongest Wat2Do visual signatures.

| Category | Background | Text |
| --- | --- | --- |
| Events | `hsl(214 96% 92%)` | `hsl(217 91% 60%)` |
| Clubs | `hsl(142 76% 94%)` | `hsl(142 71% 45%)` |
| Academic | `hsl(48 96% 89%)` | `hsl(25 95% 53%)` |
| Religious | `hsl(270 91% 95%)` | `hsl(271 81% 56%)` |
| Cultural | `hsl(0 100% 95%)` | `var(--error)` |
| Social | `hsl(188 94% 96%)` | `hsl(188 94% 39%)` |
| Sports | `hsl(0 100% 96%)` | `hsl(0 84% 50%)` |
| Career | `hsl(199 89% 96%)` | `hsl(199 89% 48%)` |
| Technology | `hsl(229 93% 96%)` | `hsl(243 75% 59%)` |
| Arts | `hsl(330 100% 97%)` | `hsl(330 81% 60%)` |
| Health | `hsl(151 81% 96%)` | `hsl(151 69% 58%)` |
| Music | `hsl(54 96% 88%)` | `var(--warning)` |
| Entrepreneurship | `hsl(142 76% 95%)` | `hsl(142 69% 58%)` |
| Default | `hsl(0 0% 96%)` | `hsl(0 0% 45%)` |

Use these colors for event identity, badges, and category accents. Avoid
inventing one-off category colors.

## Typography

Primary font:

```text
Satoshi, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif
```

Tone:

- Headlines should be confident and plainspoken.
- Body copy should be short and conversational.
- Labels should be compact.
- Event cards should prioritize scanability over prose.

Current patterns:

- App chrome: small, compact text.
- Event card title: semibold, `text-base`, tight line-height, two-line clamp.
- Secondary event details: `11px`, truncated where needed.
- Badge text: `9px` to `11px`, bold.
- Buttons: `text-sm`, normal weight.

Do not use giant marketing typography inside operational surfaces like event
feeds, filters, forms, or dashboards. Save large display type for onboarding
payoff/reward screens.

## Radius And Shape

Token scale:

| Token | Value | Use |
| --- | --- | --- |
| `--app-radius-1` | `4px` | Tiny controls, tight details |
| `--app-radius-2` | `6px` | Small controls |
| `--app-radius-3` | `8px` | Medium surfaces |
| `--app-radius-4` | `12px` | Cards, buttons, app panels |
| `--app-radius-full` | `9999px` | Pills and circular controls |

Current UI leans on `rounded-xl` (`12px`) for buttons, cards, nav items, event
cards, dialogs, and floating controls.

Guidance:

- Use `12px` for primary app surfaces.
- Use pills only for categorical choices, compact badges, and segmented
  controls.
- Avoid deeply rounded nested-card compositions.
- Avoid adding card-in-card layouts unless the inner card is a real repeated
  item, modal, or tool surface.

## Shadows And Elevation

The base layer globally suppresses arbitrary shadows. Floating surfaces are
allowed controlled elevation through tokens:

| Token | Use |
| --- | --- |
| `--app-shadow-xs` | Minimal hairline lift |
| `--app-shadow-sm` | Small cards and controls |
| `--app-shadow-md` | Medium lift |
| `--app-shadow-lg` | Dialogs, floating panels |
| `--app-shadow-xl` | Rare hero/focus surfaces |
| `--app-shadow-floating` | Popovers, dropdowns, dialogs, tooltips |
| `--app-shadow-control` | Buttons and interactive controls |

Guidance:

- Prefer borders and spacing over heavy shadows.
- Floating menus/dialogs may use `--app-shadow-floating`.
- Buttons use `data-elevation="control"`.
- Avoid decorative glow or heavy depth on normal browsing screens.

## App Shell

Current shell:

- Fixed top nav, `48px` high.
- Main content starts below nav with `mt-12`.
- Main content has `p-4` and bottom padding for the floating dock.
- Bottom-center floating dock handles primary navigation.
- School selector lives in the top nav and anchors browsing context.

The app should feel like a compact utility. Avoid landing-page structure once a
user is inside the app.

## Navigation

Top nav:

- Logo button on left.
- School selector nearby.
- Admin/organization/language/theme/auth controls on right.
- Controls are compact and mostly icon-forward on small screens.

Floating dock:

- Bottom-centered.
- Used for search, explore, create, organizations, contact, settings.
- Icons should come from the existing doodle/lucide-style icon system.

Guidance:

- Keep navigation predictable.
- Do not introduce a second primary nav pattern.
- New app sections should appear in the existing top nav or floating dock
  structure.

## Buttons And Controls

Button base:

- `rounded-xl`
- `text-sm`
- normal font weight
- compact heights: `32px`, `36px`, `40px`
- icon support built in
- focus ring via `ring`

Variants:

- `default`: primary blue fill.
- `secondary`: soft gray fill.
- `outline`: bordered white/transparent.
- `ghost`: transparent with hover fill.
- `destructive`: error fill.
- `link`: textual action.

Onboarding and preference screens should use tactile pills:

- Rounded pill or `rounded-xl`.
- Border by default.
- Selected state should be obvious through fill, outline, or primary/category
  color.
- Continue buttons should remain disabled until the screen has useful input.

## Cards

General cards:

- `bg-card`
- `border`
- `rounded-xl`
- soft or controlled shadow
- clear internal padding

Event cards:

- Image area on top.
- Category badge top-left.
- Status/menu badges in image corners.
- Organization badge bottom-left.
- Content area uses category background/text.
- Waterpaint texture adds personality.
- Bottom action rail uses three equal columns.

Event card design is the most important reusable visual object in Wat2Do.
Onboarding should use real event cards whenever possible.

## Badges

Badge style:

- Small.
- Bold.
- Rounded.
- Border or solid fill.
- Used for category, live/new state, Pro/trial status, and compact metadata.

Common badge meanings:

- `new`: primary blue.
- `live`: error red with pulse.
- `warning`: deadlines or urgency.
- Category badges: category background/text pair.

Do not over-badge. A card with too many badges becomes harder to scan.

## Forms And Inputs

Inputs should feel light and useful:

- White/card background.
- `border` or `input` token.
- `rounded-xl`.
- Muted placeholder text.
- Clear focus ring.

For onboarding, prefer buttons, pills, cards, and toggles over long forms.
Ask for typed input only when it creates immediate value.

## Motion

Motion exists but should stay subtle:

- Onboarding step transitions use fade plus small vertical movement.
- Event cards animate in with opacity and y offset.
- Faculty onboarding has a playful splash effect.
- Live badge can pulse.
- Theme toggle uses view transitions.

Guidance:

- Motion should confirm progress or make feedback feel alive.
- Avoid decorative motion that slows browsing.
- Use reward-screen motion sparingly for moments like Pro unlock or profile
  completion.

## Illustration And Imagery

Wat2Do should use real event content first:

- Event posters/images.
- Real event cards.
- Club names.
- Campus-specific language.

Illustrations can support onboarding, empty states, and reward moments, but they
should not replace actual event discovery.

Visual direction for illustrations:

- Simple, doodle-like, friendly.
- Bright accents from the existing palette.
- Avoid generic stock imagery.
- Avoid decorative orbs, bokeh, or gradient blobs as the main visual language.

## Onboarding Visual Direction

Borrow from the referenced Flow screenshots:

- Split-pane desktop layouts.
- Left side for choice/action.
- Right side for illustration, proof, or product preview.
- Strong top progress bar or compact step indicator.
- Pill choices with clear selected states.
- Product trial screens where the user actually interacts with event cards.
- Dark/high-contrast payoff screens for major value moments.
- Surprise Pro unlock screen.
- Habit challenge progress card.

Adapt to Wat2Do:

- Replace abstract product demos with real events.
- Replace typing-speed stats with campus discovery stats.
- Replace Pro trial wording with campus discovery benefits.
- Keep all public events visible in Free; Pro should feel like personalization
  and convenience.

## Responsive Rules

Mobile:

- Event grids should show two columns at standard phone widths.
- Prioritize cards and action buttons over decorative art.
- Keep copy short.
- Avoid oversized hero text inside app surfaces.
- Floating dock must not cover primary actions.

Desktop:

- Use split panes for onboarding/auth.
- Use constrained content widths for forms.
- Let event grids fill available space.
- Keep side panels useful, not decorative.

## Voice And Copy

Wat2Do copy should feel student-native but not try too hard.

Good:

- "What are you usually looking for?"
- "We found events you might actually go to."
- "Your campus radar is ready."
- "Save 3 events this week to extend Pro."
- "Free food near you."

Avoid:

- Corporate SaaS language.
- Long explanations.
- Claims that sound bigger than the feature.
- Paywall copy that implies public campus events are being hidden.

## Do And Do Not

Do:

- Use existing tokens and shared components.
- Put real event content at the center.
- Keep interfaces compact and scannable.
- Use pastel category colors for event identity.
- Use blue for primary action.
- Use high-contrast screens for rare celebration moments.
- Keep Free useful and Pro delightful.

Do not:

- Create a separate visual language for onboarding.
- Gate all event visibility behind Pro.
- Add one-off colors when category/status tokens exist.
- Overuse gradients, blobs, or decorative backgrounds.
- Nest cards inside cards for normal layout.
- Use huge hero sections inside the operational app.
- Add dense text instructions when the UI can explain itself through controls.

## Design Checklist For New Screens

Before shipping a new screen:

1. Does it use `design-tokens.css` colors/radius/shadows?
2. Does it reuse shared UI primitives where possible?
3. Is real event or club content visible if the screen is about discovery?
4. Does the layout work at phone width and desktop width?
5. Are buttons and pills large enough to tap?
6. Is the primary action obvious?
7. Is the copy short enough to scan?
8. Does the screen avoid adding a second nav, card, or filter pattern?
9. Are Free and Pro benefits positioned in a trustworthy way?
10. Does the screen feel like Wat2Do, not a generic SaaS template?
