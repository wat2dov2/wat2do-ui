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

Corner badges sit in notches cut into the card face (`shared/ui/badge-mask.tsx`
with `shared/ui/event-image-cutout.tsx`).
Their shape comes from `--notch-gap` (4px), `--notch-fillet` (8px) and
`--notch-radius` (16px, the badge's 12px plus the gap, so the notch runs
concentric with the badge); a surface marked `data-notch-size="display"` scales
them to 6px, 12px and 18px from the `sm` breakpoint up.

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

Shadows reach an element only through `data-elevation`: `control` for buttons and other raised controls, `raised` (`--app-shadow-xs`) for a thumb sitting inside a track, such as the active tab.

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

Touch targets:

- Anything tappable takes at least a 44px by 44px press on touch screens.
- A control drawn smaller (icon buttons, the bell, the avatar, a dialog's close, a card's corner Save badge) keeps its look and grows only its hit area with the `hit-area` utility (`index.css`): an invisible box centred on it, on coarse pointers only.
- `Button`'s icon sizes carry it already; a hand-built control adds `relative hit-area`.
- Leave it off a control whose grown box would cover a neighbouring target (a tag's remove button, the verified check inside a club badge) or poke out of a sideways-scrolling row.

Tabs (`shared/ui/tabs.tsx`) are the one tabbed navigation, a segmented control:

- A flat track (`--control-track`) with no shadow, `rounded-xl`, 36px high, 4px padding.
- The active label sits on a raised thumb (`--control-thumb`, `data-elevation="raised"`) whose 8px corners run concentric with the track's 12px.
- Inactive labels are muted and turn full strength on hover; only the active label is full strength at rest.
- The row never wraps: a row too wide for its space scrolls sideways inside the track, and the active tab scrolls into view.
- Counts sit in a small neutral pill after the label.

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

Lists of rows (`ItemGroup` in `shared/ui/item.tsx`):

- One list sits on one bordered `rounded-xl` surface with hairlines between its rows, rather than a box around every row.
- A row may lead with a 40px tile (`shared/ui/tile.tsx`): `DateTile` for a date (month over day), `IconTile` for an icon.
- An empty list keeps its surface and says, in one row, what will appear there and where to find it.

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

Tinted badges (`Badge` variants `tint-*`, tokens `--tint-*` in
`decorative-tokens.css`) carry one meaning each, in the hue the product already
uses for it: a soft wash of the hue behind text and icon in a darker (light
theme) or lighter (dark theme) shade of it, at WCAG AA in both themes.

| Variant | Meaning | Hue it reuses |
| --- | --- | --- |
| `tint-live` | Happening or counted now | `--destructive` (the Live badge) |
| `tint-free` | Free, no account needed | `--success` |
| `tint-new` | Freshly read from clubs' posts | `--badge-new` |
| `tint-time` | A date or time | `--warning` (the Soon badge) |

Anything else stays neutral; colour is kept for meaning.

## Forms And Inputs

Inputs should feel light and useful:

- White/card background.
- `border` or `input` token.
- `rounded-xl`.
- Muted placeholder text.
- Clear focus ring.

A switch with a label is always a `SwitchField` (`frontend/src/shared/ui/switch-field.tsx`).
The label and any description sit on the start side and the switch sits at the far end of the row, never right beside the text.
The text wraps while the switch keeps its size, and the switch lines up with the label when a description follows it.

For onboarding, prefer buttons, pills, cards, and toggles over long forms.
Ask for typed input only when it creates immediate value.

## Motion

Motion confirms what a person just did; it never makes them wait.
Its tokens live once, in `frontend/src/styles/motion.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--motion-fast` | `150ms` | Presses, hovers, colour changes (Tailwind's default `transition`) |
| `--motion-base` | `200ms` | State changes: icon swaps, menus opening, the nav filling in |
| `--motion-slow` | `250ms` | Dialogs opening |
| `--motion-max` | `300ms` | The ceiling: card entrances, the theme reveal |
| `--ease-out-ui` | `cubic-bezier(0.22, 1, 0.36, 1)` | Anything entering or answering a press (Tailwind's `ease-out` and default easing) |
| `--ease-in-ui` | `cubic-bezier(0.55, 0, 1, 0.45)` | Anything leaving (Tailwind's `ease-in`) |
| `--ease-in-out-ui` | `cubic-bezier(0.65, 0, 0.35, 1)` | A move that starts and ends on screen (Tailwind's `ease-in-out`) |

Rules:

- Interface motion runs at 300ms or less, most of it 150 to 200ms; exits run about 20% shorter than entrances.
- Nothing that moves runs at a linear speed; only endless loops (a spinner, a shine) may.
- Every animation stops under `prefers-reduced-motion: reduce`, either in `motion.css` or with `motion-reduce:`.
- Buttons shrink to 0.97 while pressed (`Button`), and cards shrink to 0.98 (`press-feedback`), so a press visibly lands before what it opens; a press on a control inside a card moves only that control.
- Turning a toggle on (Save, Follow, Notify me) pops its icon or badge once (`animate-success-pulse`), only when the person turned it on there (`useTurnOnPop`), never when it loads already on.
- Toggles change at once and send their request after, putting it back with a toast if it fails; they never dim or disable while the request runs.
- Frequent controls never move: a toggle keeps one size in both states (`IconSwap`), and loading states hold the same boxes as what they stand for.
- Reward screens (onboarding payoffs, the Pro unlock) may run longer, sparingly.

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
