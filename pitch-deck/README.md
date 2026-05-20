# Wat2Do Pitch Deck

A ~10-minute campus pitch deck built with **Vite + React + TypeScript + Swiper**, mirroring the live `wat2do.ca` UI (Satoshi font, brand blues, layered shadows).

## What it is

A standalone slideshow at `pitch-deck/` — separate from the main app so it can be demoed, exported, or deployed independently. Slide backgrounds use real event flyer images pulled live from the wat2do-v2 Supabase `events` table.

## Slide inventory (matches [EPIC 3] #53–#59)

| # | Slide | Purpose |
|---|---|---|
| 1 | Title | Hook + author + live badge |
| 2 | Problem | Broken discovery, IG-only flyers, retention |
| 3 | Market | UWaterloo size + why-now |
| 4 | Solution overview | One-screen summary + production cards |
| 5 | Pipeline | Scrape → Extract → Filter → Ship |
| 6 | Features | Interest, calendar export, QR, RSVP |
| 7 | Metrics | Funnel + sponsor questions |
| 8 | ROI | Cost-per-event-discovered |
| 9 | Demo backup | Click-through if wifi dies |
| 10 | Close | 8-week pilot ask + timeline + contact |

## Data sources

The deck fetches event image URLs at load:

1. **Primary** — `wat2do-v2` Supabase `public.events` table (column `source_image_url`).
2. **Fallback** — `https://api.wat2do.ca/api/events/` public endpoint, used **only** if the wat2do-v2 events table is empty, so the deck renders real production screenshots until wat2do-v2 ingestion is wired.

A small badge in the bottom-left of the screen always shows which source is currently feeding the deck.

## Run it

```bash
cd pitch-deck
cp .env.example .env   # already provided, override as needed
npm install
npm run dev            # http://localhost:5174
```

Production build:

```bash
npm run build
npm run preview        # http://localhost:4173
```

## Controls

- `→` / `←` — next / previous slide
- Mouse wheel — next / previous slide
- Click pagination dots — jump
- Pre-built nav arrows on the side

## Design system

Tokens live in `src/styles/tokens.css` and mirror the bug-free-octo-spork frontend:

- Font: **Satoshi** (variable WOFF2), 450 body / 800 headings / 600 strong, system-ui fallback
- Surfaces: white / from-blue-50 to-indigo-100 gradient
- Brand: `#0056D6` primary CTA, `#0488FE` accent / banner
- Rounded-xl controls, layered inset+drop shadows
- Logo: `/wat2do-logo.svg` (copied from production public/)

## Notes

- Every metric labelled `PLACEHOLDER` is intentional — real numbers wire in from Epic 2 #31 (Metrics Heist). The deck refuses to invent attendance figures.
- No prospect lists, outreach sequences, or rehearsal plans live here — that's Epic 3 Track 1, out of scope for this folder.
