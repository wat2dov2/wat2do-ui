# Wat2Do Onboarding Flow Spec

## Purpose

This document describes the intended Wat2Do onboarding experience in enough
detail that an implementation agent should not have to invent major product,
visual, or interaction decisions.

The goal is not just to collect profile fields. The goal is to make a new
student feel, within the first session:

> Wat2Do already understands my campus life, found real events I might go to,
> built my first plan, and gave me Pro as a useful surprise.

The onboarding should feel creative and artful without becoming fragile,
decorative, or overbuilt. It should use real Wat2Do event content wherever
possible and preserve the app's existing design system.

## Non-Negotiables

1. Use existing Wat2Do design tokens and shared UI patterns.
2. Use real event cards or real event-card-derived previews for discovery
   screens.
3. Keep public events visible in the free tier. Pro is about personalization,
   memory, alerts, calendar, and convenience.
4. Every screen must have a clear loading, empty, disabled, and mobile state.
5. The user must be able to complete onboarding even if there are few or no
   matching events.
6. Do not add fake data that looks real unless it is explicitly labeled as a
   preview.
7. Do not make a generic SaaS onboarding wizard. This is a campus event
   discovery product.
8. Do not create a separate visual language for onboarding. Make onboarding feel
   like the most expressive version of Wat2Do.

## Existing Product Patterns To Reuse

Use these existing concepts rather than building parallel ones:

- Event cards: `EventCard`, `PreviewStyleEventCard`, `EventCardContent`.
- Category colors: existing event category tokens.
- Buttons: shared `Button` variants.
- Pills/chips: existing rounded control styling.
- Progress: existing onboarding progress indicator or a visually compatible
  replacement.
- School context: current school/profile flow.
- Saved events: existing saved-event store/API behavior.
- Event lists: existing event fetch/filter/store pipeline.

If implementation needs a new component, it should be because the existing
component does not fit the screen's layout, not because the same pattern was
rewritten in a different style.

## Creative Direction

The Flow onboarding inspiration is effective because it has a rhythm:

1. Simple questions.
2. Real setup.
3. A guided product trial.
4. A personalized stat.
5. A surprise upgrade.
6. A challenge that creates a habit.

Wat2Do should adapt that rhythm:

1. Simple campus-life questions.
2. Real event matching.
3. A guided event-picking moment.
4. A personalized campus discovery payoff.
5. A surprise Wat2Do Pro unlock.
6. A challenge that rewards saving, following, inviting, or submitting event
   tips.

The aesthetic should be:

- Spacious but not empty.
- Soft, clean, and campus-friendly.
- Event-card-first, not illustration-first.
- Playful through composition, color, motion, and copy.
- Artsy in specific moments: payoff screens, Pro unlock, progress challenge.
- Operationally solid on all screens.

Good art direction:

- Split-pane layouts with one side for action and one side for product preview.
- Large simple headlines.
- Tactile pill controls.
- Animated but subtle progress.
- Real event cards arranged like a collage, stack, or weekly plan.
- Occasional dark reward screen with high-contrast type and category-colored
  accents.
- Small campus doodle elements as supporting marks.

Bad art direction:

- Generic gradient hero sections.
- Decorative blobs/orbs/bokeh backgrounds.
- Huge marketing copy above tiny product content.
- Fake dashboards full of invented metrics.
- Cards nested inside cards just to create visual density.
- A flow that looks good in one screenshot but breaks with real text or empty
  event data.

## Tier Model Introduced By Onboarding

Free:

- Browse all public events.
- Search events.
- Use basic filters.
- View event details.
- Browse club pages.

Pro:

- Personalized recommendations.
- Saved events.
- Followed clubs.
- Calendar export or sync.
- Smart reminders.
- Instant matching alerts.
- Free food alerts.
- RSVP deadline alerts.
- Weekly personalized plan.
- Campus Taste Profile.
- Pro extension challenges.

Onboarding must introduce Pro as a gift:

```text
You have been upgraded to Wat2Do Pro for 14 days.
No payment needed.
```

Do not imply:

```text
Pay to see all events.
```

## Global Layout

Desktop:

- Use a full-height onboarding shell.
- Top area contains progress and secondary controls such as language/theme.
- Main area uses a two-zone layout where appropriate:
  - Left: question, controls, primary action.
  - Right: artful product preview, event collage, or proof panel.
- Keep content vertically centered but leave enough bottom space for buttons.
- Avoid scroll on normal desktop sizes, but support scroll if content exceeds
  height.

Mobile:

- Single-column flow.
- Show the headline and controls first.
- Product preview appears below the core action, not above it unless it is the
  main task.
- Standard phone width event grids should show two columns where cards are
  usable.
- Primary action stays visible at the bottom or clearly follows the content.
- No text, buttons, or cards may be covered by the floating dock or browser
  viewport edge.

Progress:

- Use a top progress indicator.
- Suggested labels:
  - Start
  - Personalize
  - Discover
  - Unlock
- The indicator should communicate progress without making the flow feel long.

## Global Interaction Rules

- Continue buttons are disabled until required input exists.
- Back is available after the first screen.
- Skip is allowed only on screens where skipping does not break downstream
  state.
- All selections must be reversible before completion.
- Keyboard users must be able to tab through controls, select options, go back,
  and continue.
- All image content needs useful alt text unless decorative.
- No screen should depend on animation to be understandable.
- If data fails to load, show a recovery path and allow completion.

## Screen 1: Welcome And Source

### Intent

Start with a low-friction question. The user should think, "Okay, this is easy,"
not "I am doing paperwork."

### Layout

Desktop:

- Left pane: white/card-like content area with large headline and source pills.
- Right pane: warm Wat2Do visual, preferably an event-card collage or simple
  student/campus illustration.
- Top progress bar starts at the first segment.

Mobile:

- Headline, question, pill grid.
- Illustration is small and optional below the pills.

### Visual Treatment

- Background: `--background`.
- Left pane: no heavy card border unless needed for contrast.
- Right pane: pale secondary background or event-card collage.
- Pills: outline by default, selected state uses primary or a soft category
  accent.

### Copy

```text
Welcome to Wat2Do

Where did you hear about us?
```

Options:

- Instagram
- Friend
- Club exec
- Orientation
- Reddit
- Discord
- Search
- Poster
- Other

### Behavior

- Single select.
- Continue disabled until selected.
- `Other` may either select directly or reveal a small optional text field.
- Store this as acquisition/source data only. Do not let it affect event
  recommendations.

### Edge States

- If source persistence fails, continue anyway and log/report gracefully.
- If text wraps in any pill, the pill height may grow, but text must not clip.

## Screen 2: Campus Intent

### Intent

Learn what the student wants from campus life. This should feel like choosing a
vibe, not filling out demographics.

### Layout

Desktop:

- Left pane: headline, short explanation, multi-select pills.
- Right pane: proof/product panel with real event examples matching selected
  interests if available.

Mobile:

- Headline and pills first.
- Below the pills, show a small "Your feed is warming up" preview with 2 to 4
  event-category chips or cards.

### Copy

```text
What are you usually looking for?

Pick a few. We will use this to shape your first feed.
```

Options:

- Free food
- Meet people
- Career events
- Tech
- Arts
- Culture
- Sports
- Study sessions
- Volunteering
- Parties
- Chill socials
- Something random

### Behavior

- Multi-select.
- Require at least one selection.
- Recommended maximum is 5 selections, but do not block the user if they choose
  more.
- Selected pills should animate or visually settle, but the layout must not jump
  dramatically.

### Right-Side Preview

If matching events exist:

- Show 2 to 4 mini event cards from matching categories.
- Label softly:

```text
Starting to shape your feed
```

If no matching events exist:

- Show category color chips instead of empty cards.
- Copy:

```text
We will still find upcoming events across campus.
```

## Screen 3: Availability And Social Mode

### Intent

Make recommendations feel practical. The app should not just know what the user
likes; it should know when they can actually go.

### Layout

Desktop:

- Center-left content with time pills.
- Right preview resembles a weekly strip or simple calendar rail.
- The preview updates as time options are selected.

Mobile:

- Time choices in a responsive pill grid.
- Social mode choices as a three-option segmented row or stacked cards.

### Copy

```text
When are you usually free?

This helps us find events you can actually make.
```

Time options:

- Tonight
- Weekdays after class
- Weekends
- Lunch breaks
- Evenings
- I am flexible

Then:

```text
How do you usually go?
```

Social options:

- Solo
- With friends
- Looking to meet people

### Behavior

- Time is multi-select.
- Social mode is single-select.
- Require at least one time option.
- Social mode can default to no selection and still allow continue, unless the
  implementation explicitly uses it.

### Edge States

- If no event dates are available, the weekly preview should show a graceful
  empty plan state instead of blank space.

## Screen 4: Real Event Match

### Intent

This is the first real product moment. The user should interact with actual
Wat2Do events before onboarding asks anything else.

### Layout

Desktop:

- Full-width discovery layout.
- Header at top with a short line of copy.
- Main area: responsive event-card grid or horizontal/card-stack composition.
- Side or bottom area: progress like "0/3 picked".

Mobile:

- Header remains compact.
- Grid should show 2 columns at standard phone width.
- Reaction controls must be thumb-friendly.

### Copy

```text
We found events you might actually go to

Pick a few that catch your eye.
```

### Cards

Use real event card visuals. If full `EventCard` is too large or includes
actions that do not belong in onboarding, use `PreviewStyleEventCard` and add
onboarding-specific reaction controls.

Each card should show:

- Event image or category fallback.
- Category badge.
- Organization.
- Title.
- Date.
- Time.
- Location if available.

### Reactions

Use three simple actions:

- Interested
- Maybe
- Not for me

Implementation may present these as:

- A small action rail below the selected/focused card.
- Three compact buttons on each card.
- Swipe/stack controls on mobile only if implemented robustly.

Do not hide the event details behind the reaction controls.

### Behavior

- Require at least 2 reactions before continue.
- "Interested" adds to onboarding selected events and should become saved after
  profile completion if the save API supports it.
- "Maybe" tunes recommendations but does not save.
- "Not for me" tunes recommendations away from that category/club.
- A reacted card must clearly show its selected reaction.
- Users can change a reaction.

### Loading

- Show event-card skeletons using the same grid dimensions.
- Do not show a spinner-only page.

### Empty State

If matching events are empty:

```text
We could not find perfect matches yet, so here are popular events at your school.
```

Then show popular/upcoming events.

If no events exist at all:

```text
No events are ready right now, but your feed will update as clubs post.
```

Allow continue with:

```text
Continue without picks
```

### Failure State

If event loading fails:

- Show a friendly error.
- Provide "Try again".
- Provide "Continue without picks".

## Screen 5: Campus Radar Payoff

### Intent

Turn the user's selections into an emotional reward. This is where onboarding
should become artful.

### Layout

Desktop:

- Dark or near-black full-screen payoff.
- Large display headline.
- One large personalized stat.
- Supporting mini stats/cards.
- Product art: selected event cards orbiting, stacking, or snapping into a
  weekly plan.

Mobile:

- Keep the large stat, but avoid oversized text that wraps awkwardly.
- Stack stats vertically.

### Visual Treatment

- Background: dark theme surface or `hsl(0 0% 9%)`.
- Text: high contrast.
- Accents: selected category colors, primary blue, soft pastel lines.
- Use motion only for entrance: cards slide/settle, stat counts up, accent line
  draws in.

### Copy

Primary:

```text
Nice. Your campus radar is ready.
```

Stat examples:

```text
You matched with 7 events this week.
```

```text
Your strongest vibe: free food + chill socials.
```

```text
Thursday evening looks like your best night out.
```

```text
You found 3 clubs you have not followed yet.
```

### Behavior

- Continue is always available.
- "Edit picks" may return to Screen 4.
- If personalized stats are weak because of limited data, use safe copy:

```text
Your first campus feed is ready.
```

Do not invent precise numbers if they are not backed by data.

## Screen 6: Build My Week

### Intent

Give the user a tangible asset: a first weekly plan. This is the moment where
onboarding stops being "setup" and becomes "Wat2Do did work for me."

### Layout

Desktop:

- Left pane: short explanation and action.
- Right pane: weekly plan preview.
- The weekly plan should look like a real app module that can appear again on
  the home page.

Mobile:

- Headline.
- Weekly plan preview.
- Primary action.

### Copy

```text
We built your first Wat2Do week

Your saved events, matching clubs, and best nights out are ready.
```

### Weekly Plan Preview

Show a compact list:

- Tonight: event count or best pick.
- This week: total matches.
- Clubs to follow: count.
- Free food alerts: on/off based on preferences.

Example:

```text
Tonight
1 event worth checking out

This week
4 matches from clubs around Waterloo

Clubs to follow
3 suggestions
```

### Behavior

- Primary action: "Show my week".
- Secondary: "Continue".
- Avoid "Skip personalization" unless it actually changes saved state.

### Edge States

If no selected events:

```text
We made a starter feed instead. You can tune it as you browse.
```

If event data is unavailable:

```text
Your feed will fill in as soon as events load.
```

Continue remains available.

## Screen 7: Surprise Pro Unlock

### Intent

Create a generous "wait, really?" moment.

### Layout

Desktop:

- Split screen.
- Left: upgrade message and button.
- Right: bold Pro visual.
- Pro visual should be Wat2Do-specific: a campus radar, event cards, calendar
  reminders, and free-food alert markers.

Mobile:

- Badge, headline, benefits, visual, button.
- Avoid making the benefits list so long that the button is pushed below an
  awkward scroll.

### Visual Treatment

- Use a strong color field or dark reward surface.
- Avoid copying Flow's green panel literally.
- Good Wat2Do options:
  - Primary blue field with pastel event cards.
  - Dark background with category-color orbit lines.
  - Cream/white left pane plus vivid right pane.
- Include a small Pro badge.

### Copy

```text
2-week Pro trial

You have been upgraded to Wat2Do Pro

Enjoy personalized campus discovery for 14 days. No payment needed.
```

Benefits:

- Save events.
- Follow clubs.
- Get instant matching alerts.
- Sync events to your calendar.
- Get free food and RSVP reminders.
- Unlock your Campus Taste Profile.

Button:

```text
Great
```

### Behavior

- No credit card.
- No payment modal.
- Trial state should be persisted if the backend/product supports it.
- If Pro persistence fails, the user can still finish onboarding; show Pro trial
  state locally if appropriate and retry in the background.

### Anti-Pattern

Do not say:

```text
Unlock all events with Pro.
```

## Screen 8: Pro Extension Challenge

### Intent

Create the habit loop. The user should leave with a concrete reason to come
back this week.

### Layout

Desktop:

- Left: challenge copy.
- Right: progress card.
- The progress card should visually match a home-page module.

Mobile:

- Progress card appears directly under the headline.
- Button remains easy to reach.

### Copy

```text
Keep Pro going by using Wat2Do this week

Save 3 events this week to extend Pro by 7 days.
```

Progress card:

```text
Campus Explorer Challenge

1 / 3 events saved

Reward: +7 days of Pro
```

### Behavior

- Progress should reflect events selected as "Interested" during onboarding.
- If the user selected no events, progress starts at `0 / 3`.
- Button: "Finish".
- Secondary link: "Maybe later" only if needed.

### Challenge Options

MVP challenge:

- Save 3 events this week: +7 days of Pro.

Future challenges:

- Invite 1 friend: +1 month of Pro.
- Submit a missing event tip: +7 days of Pro.
- Follow 5 clubs: unlock Campus Taste Profile early.
- Add 1 event to calendar: +3 days of Pro.

Do not implement multiple challenge mechanics until the MVP challenge is stable.

## Screen 9: First Home Page Moment

### Intent

The home page must prove onboarding mattered. The user should not land on the
same generic event list everyone else sees.

### Layout

- Personalized greeting.
- Recommended event section.
- Saved or picked events section.
- Pro trial/challenge card.
- Free food or "happening soon" module if relevant.

### Copy

```text
Hey Tony, here is what is worth checking out this week.
```

Modules:

- Recommended for you.
- Saved this week.
- Free food near you.
- Clubs you might like.
- Campus Explorer Challenge.
- Trial ends in 14 days.

### Behavior

- Event picks from onboarding should appear immediately.
- Challenge progress should match onboarding selections.
- If no personalized data exists, fall back to popular/upcoming events and keep
  the challenge visible.

## Data Contract For Onboarding

The flow should produce a single coherent onboarding payload, not scattered
parallel state.

Suggested shape:

```ts
type OnboardingProfile = {
  source?: string;
  interests: string[];
  availability: string[];
  socialMode?: "solo" | "friends" | "meet_people";
  selectedEventIds: number[];
  maybeEventIds: number[];
  dismissedEventIds: number[];
  proTrialAccepted: boolean;
  challengeId: "save_3_events";
};
```

Frontend and backend must agree on what is persisted. Do not send fields the
server ignores unless they are explicitly local-only and kept out of API
payloads.

## State And Persistence Rules

- Profile fields should persist only when the user completes onboarding, unless
  the existing app already persists partial onboarding.
- Event reactions can live locally during onboarding.
- Saved events should be saved after authentication/profile completion using the
  existing saved-events mechanism.
- Pro trial/challenge state should have one source of truth.
- If the backend does not yet support Pro trial/challenge persistence, implement
  the UI as a non-persistent concept only after explicitly marking the gap.

## Accessibility Requirements

- All controls must be reachable by keyboard.
- Pill groups need accessible labels.
- Selected state must not rely on color alone.
- Continue/back controls need clear names.
- Progress indicator needs an accessible current-step label.
- Event cards in onboarding must not trap focus.
- Motion should respect reduced-motion preferences.
- Text must fit at mobile widths and in Chinese/localized copy.

## Responsive QA Requirements

Check at minimum:

- 320px width.
- 375px width.
- 390px width.
- 430px width.
- 768px tablet.
- 1024px desktop.
- 1440px desktop.

Every screen must satisfy:

- No overlapping text.
- No clipped buttons.
- No hidden primary action.
- No event-card action rail covering event details.
- No horizontal scroll unless intentionally used for a carousel.
- 2-column event grid at standard phone widths where practical.
- Single-column fallback at very narrow widths.

## Loading, Empty, And Failure Matrix

Every implementation should explicitly handle:

| Area | Loading | Empty | Failure |
| --- | --- | --- | --- |
| Source save | Continue normally | Not applicable | Continue and retry/log |
| Interest preview | Show chips/skeletons | Show selected category chips | Hide preview and continue |
| Availability preview | Show calendar skeleton | Show starter plan | Hide preview and continue |
| Event match | Card skeletons | Popular events, then continue without picks | Try again + continue without picks |
| Payoff stats | Generic payoff | Generic payoff | Generic payoff |
| Weekly plan | Plan skeleton | Starter feed copy | Starter feed copy |
| Pro trial | Static unlock | Static unlock | Finish allowed, retry persist |
| Challenge | `0 / 3` if unknown | `0 / 3` | Show challenge, retry persist |

## MVP Scope

Build first:

1. Welcome/source.
2. Campus intent.
3. Availability/social mode.
4. Real event match with reactions.
5. Campus radar payoff.
6. Build my week preview.
7. Pro trial unlock.
8. Save-3-events challenge.
9. Personalized home landing state.

Do not build first:

- Swipe-only card stack.
- Attendance verification.
- Friend graph or group planning.
- Multiple simultaneous challenges.
- Payment or subscription screens.
- Complex generated illustrations.
- Full Campus Taste Profile analysis.

## Implementation Guardrails

To avoid overfitting the rough idea and breaking the product:

1. Start from current onboarding/auth/event-card components.
2. Change one screen at a time and verify mobile after each screen.
3. Use real data paths before adding decoration.
4. Keep the event-card interaction working before adding motion.
5. Do not introduce new global state unless existing stores cannot support the
   flow.
6. Do not add Pro APIs or fake subscription logic unless persistence is defined.
7. If a screen requires unsupported backend behavior, document the gap and keep
   the UI honest.
8. Prefer fewer polished screens over many fragile screens.

## Acceptance Criteria

The onboarding is acceptable when:

- A new user can complete it end to end.
- A returning user is not forced through it again.
- Mobile layout is clean at standard phone widths.
- The event match screen uses real events or a clearly labeled fallback.
- Empty event data does not block completion.
- Selected interests and event picks affect the first home-page state.
- Pro trial copy is generous and does not imply event access is paywalled.
- Challenge progress reflects onboarding actions.
- All screens pass lint, typecheck, and relevant tests.
- Manual browser QA confirms no overlapping text, clipped controls, blank
  panels, or broken navigation.

## Success Metrics

Track:

- Onboarding start-to-completion rate.
- Event reaction rate during onboarding.
- Number of interested events selected.
- First-session event detail opens.
- First-session saved events.
- Return rate within 7 days.
- Challenge completion rate.
- Calendar or email opt-in rate if those are part of Pro.

The most important metric is not just completion. It is whether the user saves,
opens, or meaningfully reacts to real events before leaving their first session.
