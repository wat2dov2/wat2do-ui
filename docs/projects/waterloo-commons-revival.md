# Project: Waterloo Commons Revival (Brayden Collab)

Status: planned (meeting week of Jul 21, 2026).
Owner: Tony.

## Brief

Land a partnership where Waterloo Commons (4k UW followers, dormant since Nov 2025) comes back for fall term powered by wat2do.
Every post carries "powered by wat2do.ca" attribution and funnels to wat2do event pages.
Secondary thread: bring Brayden (also runs @designwaterloo) on as an informal design advisor for wat2do, consulting on branding philosophy and product direction, plus the QR poster kit as the first concrete piece.

### The wedge

Brayden already described his dream tool: form submission in, auto-generated post out, one-click approve.
We show up to the meeting with that tool working.
It is deliberately dead simple: a single frontend page that takes raw event info, makes one AI call to extract structured metadata plus a caption, and renders the post as a fixed Commons-style template in frontend code (HTML/CSS to PNG export).
No Instagram API, no backend, no scheduling.
Throwaway demo quality; production only gets built if he says yes.

### The template contract (from his existing posts)

Photo background, top-right category badge ("EXPLORE"), white host-org label ("KW Creators"), big uppercase title, right-aligned outlined pill tags (max 3, e.g. "PAPRIKA SCREENING"), and a fixed bottom row: Waterloo Commons logo (never changes), venue, date/time.
Everything except the logo and layout is an editable slot.

### Timeline

| Date | Milestone |
|---|---|
| Jul 14-18 | Build demo (issues 1.1-1.3) |
| Jul 18-20 | Generate 3 sample posts from real wat2do events, dry-run the demo (2.1) |
| Week of Jul 21 | Meeting with Brayden (2.2), late PM ET |
| Within 24h after | Recap plus pilot proposal (3.1) |
| By Jul 31 | Pilot: 5 real posts approved by Brayden (3.1) |
| Sep 1 | Commons relaunched into frosh week, aligned with QR poster campaign (3.2) |

### Success

He says yes to the fall revival with attribution baked in.
Pilot posts are live by end of July.
He agrees to an ongoing advisory role on wat2do brand and product.

## Issues

### 1.1 Commons post template component

Standalone throwaway app (single React page or even one HTML file, not in the wat2do repo).
Fixed-layout poster component at IG portrait ratio (1080x1350): photo slot (drag-drop upload, cover-fit), top-right badge (text plus preset colors, default orange), host-org white label, uppercase multi-line title, up to 3 outlined pill tags right-aligned, fixed bottom row (hardcoded Waterloo Commons logo asset, venue block, date/time block).
Every text slot is inline-editable after render.
Match his typography and spacing closely from reference posts.
Done when: hand-filled fields produce a poster that passes side-by-side with the real Animation Celebration post.

### 1.2 AI metadata plus caption generation

One API call (Claude): input is pasted freeform event info in any format (form dump, event description, wat2do event text).
Output is strict JSON: `{title, host_org, badge, pills[max 3, short, uppercase], venue, date_line, time_line, caption}`.
The prompt is the whole product here: few-shot it with the Animation Celebration example and enforce pill brevity, title casing, and the exact caption format matching his real posts:

```text
{TITLE} — hosted by {org}

🗓️ {date @ times}
📍 {venue}

{2-3 sentence energetic description}

RSVP + more events on wat2do.ca
```

The dash in the first line is his format, kept verbatim.
Done when: 5 different raw event inputs each produce render-ready JSON, with at least 4 needing zero manual fixes.

### 1.3 Generator page wiring plus export

Textarea (paste event info) plus photo upload, then Generate, then the template renders populated, the user edits any slot inline, then Export PNG (html-to-image at 1080x1350) and Copy caption.
That is the entire UI.
Done when: raw text plus photo becomes a downloadable post and caption in under 60 seconds, demoable on screen share.
Depends: 1.1, 1.2.

### 2.1 Three sample posts from real wat2do events

Use the tool on 3 real upcoming wat2do events with real photos.
Assemble a side-by-side (his old grid vs ours) for the screen share.
Done when: the three posts would not look out of place on his grid.
Depends: 1.3.

### 2.2 Meeting agenda plus pitch one-pager

One page covering:
opening (fan-first, ask why Commons blew up);
demo script (2.1 posts, then live-generate one);
the Commons offer (he owns the account, vetoes every post, roughly 2 min/day approving, we do everything else, attribution and wat2do links in return);
and the advisory ask.
The advisory ask is framed as three layers he opts into at whatever depth he likes:
(a) branding philosophy, how wat2do should look, feel, and speak on campus;
(b) product feedback, a standing invite to tear apart the app and the event pages his posts will link to;
(c) the QR poster kit as the first concrete design piece.
Plant, do not push, the succession question ("what happens to Commons when you graduate?").
Close on one concrete step: pilot 5 posts before end of July.
Done when: the doc exists and the demo dry-run follows it start to finish.

### 3.1 Post-meeting follow-up plus pilot (conditional on meeting)

Recap within 24h with sample posts attached and the pilot proposal: we generate, he approves, 5 posts live by Jul 31.
Include a one-line summary of whatever advisory arrangement he responded to so it does not evaporate after the call.
All follow-through is on us; never leave a step waiting on his initiative.

### 3.2 Productionize (only if pilot succeeds, placeholder)

Auto-feed the generator from the wat2do scraper, a one-tap approval surface for Brayden, a posting workflow, and a relaunch timed to frosh week alongside the QR poster campaign.
Fold his branding and product input into the fall roadmap as it materializes.
Scope properly only after the pilot; do not build early.
