# Wat2Do SEO Playbook

Status: active operating playbook.
Owner: Tony.
Last updated: August 2, 2026.
Review cadence: monthly, and after any search-indexing incident or major public-route change.

## Purpose

This document is the single source of truth for how Wat2Do approaches organic search.
It turns SEO into a maintained product discipline instead of a collection of one-off metadata changes.

The goal is not rankings by themselves.
The goal is qualified, non-branded discovery that helps a student find a useful event or organization and then take a meaningful action.

Primary outcomes are:

1. More students discover school-specific event and organization pages through non-branded search.
2. Search visitors land on complete, trustworthy, current pages that answer their intent immediately.
3. Search traffic produces event detail views, organization exploration, saved events, newsletter sign-ups, registrations, or other agreed product outcomes.
4. Wat2Do earns durable campus authority without mass-producing thin or derivative pages.

## Operating principles

### 1. Make useful pages indexable, not every possible URL

Index only public pages with a clear search intent, unique value, and enough visible information to satisfy that intent.
Private workflows, utility routes, duplicate hosts, empty states, internal search combinations, and invalid resources do not belong in the index.

### 2. Search engines and users receive the same complete page

Every indexable page must return meaningful, semantic HTML without requiring a crawler to complete a client-only data-fetching flow.
Do not create bot-specific rendering or a second SEO-only representation.
Use the same server-rendered or pre-rendered content that hydrates for users.

### 3. One intent has one canonical URL

Each event, organization, school directory, and public landing page has one preferred absolute URL.
Host variants, tracking parameters, filters, sort orders, and legacy routes must not compete with that URL.

### 4. Earn indexing through original utility

Wat2Do aggregates event information, so every indexable page must add clear product value beyond reproducing a source post.
Useful value includes normalized dates and time zones, school context, category and organizer relationships, attendance details, source attribution, cancellation state, related events, and reliable navigation.
Pages that contain little more than copied or automatically transformed source text must remain out of Search until they meet the quality gate.

### 5. Measure business impact, not SEO theater

Clicks, qualified landing sessions, and downstream product actions matter more than a vanity keyword position.
Impressions are an early signal, click-through rate is a result-quality signal, and average position is a diagnostic rather than the north-star metric.

### 6. Follow first-party guidance

Use Google Search Central, Search Console, Bing Webmaster Tools, schema.org, and current Next.js documentation as the default references.
Treat third-party SEO scores and checklists as prompts for investigation, not as requirements.

## Target search intents

Wat2Do should prioritize the intents where its live inventory and campus context produce a better result than a generic social post.

| Priority | Search intent | Example query pattern | Best landing page |
| --- | --- | --- | --- |
| 1 | Find current campus events | `events at University of Waterloo`, `UW events this week` | School event feed |
| 1 | Find a known event | `[event name] Waterloo`, `[event name] date` | Event detail |
| 1 | Find campus clubs | `University of Waterloo clubs`, `UW student organizations` | School organization directory |
| 1 | Find a known organization | `[organization name] Waterloo`, `[club name] events` | Organization detail |
| 2 | Find a type of campus event | `free food events Waterloo`, `tech events UW` | Evidence-gated editorial or category landing page |
| 2 | Decide what to do soon | `things to do at UW this weekend` | Evidence-gated school time-window landing page |
| 3 | Learn about the promoter program | `student promoter program Waterloo` | Public promoter page |

Do not create a landing page merely because a keyword can be generated.
A new search landing page requires demonstrated demand, sufficient matching inventory, unique visible copy, useful internal links, and a maintenance owner.

## Current baseline

This baseline was produced from the repository and read-only production response checks on August 2, 2026.
It is not a substitute for Search Console data.

### What already exists

- The frontend uses the Next.js App Router and defines global metadata in `frontend/src/app/layout.tsx`.
- The global metadata includes a title, description, robots directive, site name, manifest, Open Graph fields, and Twitter fields.
- The school home page and organization directory already have server-side snapshot loaders.
- Public event and organization detail routes have stable ID-based URLs.
- Event records already expose several useful search fields, including title, occurrences, time zone, location, organizer data, source URL, price, registration state, image, school, and cancellation state.
- The product has natural internal relationships among schools, events, organizations, and similar events.

### Confirmed gaps and risks

- Representative production routes return the same global title, description, Open Graph URL, and robots directive.
- The global Open Graph URL is `https://wat2do.io` even when the requested page is on a school subdomain or a detail route.
- No self-referencing canonical link was found on representative production pages.
- `robots.txt`, `sitemap.xml`, and `sitemap-index.xml` returned HTTP 404 on the Waterloo production host.
- Event detail and organization detail responses did not contain page-specific visible content in the initial HTML and relied on client-side queries for their primary content.
- The home response contained event data in the Next.js payload, but the conventional initial HTML did not expose the event feed as semantic page content and crawlable links.
- The client changes `document.title` after navigation, but server responses still contain generic route metadata.
- Login and the `all` administrative host currently inherit `index, follow`.
- An invalid event ID returned HTTP 200 and a client-rendered error path, which creates a soft-404 risk.
- There is no page-specific social image strategy in the current global metadata.
- Many event records lack a description, an image, a structured postal address, or an unambiguous public-attendance signal.
- Some source feeds can produce near-duplicate event records, so indexing and structured data cannot assume every record is unique.
- The product supports English and Chinese in client state, but language variants do not currently have stable, separately crawlable URLs.

### Baseline unknowns to collect

- Search Console ownership and historical data for the domain and school subdomains.
- Indexed URL count and exclusion reasons by page type.
- Non-branded impressions, clicks, and click-through rate by school and page type.
- Queries that already surface Wat2Do between positions 4 and 20.
- Search landing conversion rate and retention compared with other acquisition sources.
- Field Core Web Vitals at the 75th percentile for public page templates.
- Referring domains, linked public pages, and existing campus backlinks.
- Bing index coverage and crawl behavior.

## ROI scoring heuristic

Score every SEO proposal before it enters the committed backlog.

Use a 1 to 5 score for impact, confidence, reach, and effort.

`ROI score = (impact x confidence x reach) / effort`

Definitions:

- Impact measures the expected change in qualified organic traffic or a downstream product outcome.
- Confidence measures the strength of first-party guidance, current data, and direct evidence from Wat2Do.
- Reach measures how much of the valuable public URL inventory is affected.
- Effort includes engineering, data cleanup, content operations, QA, monitoring, and ongoing maintenance.

The numeric score ranks comparable work, but dependencies and risk can override it.
For example, measurement setup must precede experiments even if a metadata task has a higher raw score.

Priority bands:

| Band | Rule |
| --- | --- |
| P0 | Blocks crawling, indexing, canonicalization, measurement, or correct HTTP behavior across important page types |
| P1 | Improves relevance, search appearance, internal discovery, or content quality across a major page type |
| P2 | Evidence-backed expansion or optimization with a narrower reach |
| P3 | Experimental work with uncertain demand or weak business linkage |

## Non-negotiable SEO rules

### Crawl, render, and status rules

- An indexable URL returns HTTP 200 and useful visible content in the initial response.
- A resource that does not exist returns HTTP 404 or 410, not a generic HTTP 200 shell.
- A moved resource uses one permanent redirect to its replacement and is removed from the sitemap.
- A temporarily unavailable page returns an honest temporary status and is not disguised as a successful page.
- Essential page content, headings, metadata, structured data, and internal links do not depend on post-load browser state.
- Public content uses the existing server-rendering and hydration path rather than a crawler-specific rendering service.
- Every important page is reachable from at least one other public page through an `<a href>` or Next.js `Link` with descriptive anchor text.
- Infinite scroll has a crawlable paginated or otherwise finite discovery path if it is the only way to reach important pages.

### Indexing rules

- Index a page only when it has a primary search intent, unique visible value, and a stable canonical URL.
- Apply `noindex, follow` to private, account, administrative, utility, internal search, and thin duplicate pages that users may still visit.
- Do not use `robots.txt` as a substitute for `noindex` or canonicalization.
- Do not place a `noindex` URL, redirect, error URL, or non-canonical duplicate in a sitemap.
- Do not index empty directories, invalid school hosts, empty search results, or filter combinations with no independent search value.
- Do not index the `all` host because it is an administrative lens, not a public school destination.
- Do not index URL parameters by default.
- Promote a parameter combination to a dedicated landing page only when Search Console shows repeatable demand and the page can provide unique, maintained value.

### Canonical and host rules

- Every indexable page has an absolute, self-referencing canonical URL in its initial HTML.
- The canonical host matches the owning school for school-specific events, organizations, and directories.
- A school-owned event or organization requested on the wrong school host permanently redirects to its owning host.
- Internal links, sitemap entries, Open Graph URLs, and structured-data URLs use the same canonical URL.
- The root host must have a deliberate role.
- If the root host is a unique brand and school-selection page, it may be indexed independently.
- If the root host serves the Waterloo feed, it must permanently redirect or canonicalize consistently to the Waterloo host rather than compete with it.
- Canonical behavior must not be changed by client-side JavaScript after the response arrives.

### Page-title and snippet rules

- Every indexable page has one concise, descriptive title generated from visible page data.
- The primary topic appears early in the title, and `Wat2Do` appears as the brand suffix when space allows.
- Every page has one visible H1 that describes the same primary topic as the title.
- Every indexable page has a unique, human-readable meta description that summarizes the page and includes useful differentiators.
- Programmatic descriptions may use structured page data, but they must read naturally and must not become keyword lists.
- Do not enforce a brittle character count.
- Write the most useful copy first and review actual Search Console click-through rate and displayed snippets.
- Do not add a meta-keywords tag.
- Do not repeat a keyword to meet a density target.

Recommended title patterns:

| Page type | Pattern |
| --- | --- |
| School event feed | `[School name] Events and Things to Do | Wat2Do` |
| Event detail | `[Event name] at [School or location] | Wat2Do` |
| Organization directory | `[School name] Clubs and Student Organizations | Wat2Do` |
| Organization detail | `[Organization name] Events at [School name] | Wat2Do` |
| Promoter page | `Promote Campus Events at [School name] | Wat2Do` |

These are templates, not mandatory literal strings.
Shorten or adapt them when actual names would produce repetitive or misleading results.

### Content-quality rules

- The main content must immediately answer who, what, when, where, and how to attend whenever the source data supports those facts.
- Display the original organizer or source and a truthful update state so students can verify time-sensitive details.
- Never invent missing descriptions, addresses, prices, eligibility, or accessibility details for the sake of schema completeness.
- Automatically generated copy must add real user value and must be reviewable against the source record.
- A page with insufficient source data stays out of the index rather than shipping an SEO-shaped placeholder.
- School and organization names use their canonical display names consistently.
- Event titles remove extraction noise, promotional boilerplate, handles, and duplicate date or price fragments when those facts have dedicated fields.
- Near-duplicate events are consolidated before indexing when they represent the same real-world event.
- Content written for search must also be content the product would be proud to show a direct visitor.

### Internal-linking rules

- School home pages link to important event details and the organization directory with descriptive text.
- Organization directories link to every indexable organization detail page through crawlable pagination.
- Organization pages link to their current indexable events.
- Event pages link to the organizer page when one exists and to genuinely related events.
- Breadcrumbs express the real hierarchy: school, directory, detail.
- Anchor text names the destination instead of using generic phrases such as `click here` or `learn more`.
- Client-only buttons are not the sole discovery path for indexable content.
- No important page may be orphaned even if it appears in a sitemap.

### Sitemap and robots rules

- Serve a valid `robots.txt` from every public host and reference that host's sitemap.
- Generate sitemaps from the same canonical URL and eligibility rules used by page metadata.
- Include only URLs that return HTTP 200, permit indexing, and declare themselves canonical.
- Use truthful `lastmod` values from meaningful content changes rather than the time the sitemap was generated.
- Separate sitemaps by school and page type when that improves monitoring or when URL volume requires it.
- Keep upcoming events and other high-value fresh pages discoverable immediately after publication or material update.
- Remove redirects, invalid records, private routes, filter combinations, and thin pages from sitemap output.
- Submit sitemap locations in Search Console and Bing Webmaster Tools and monitor fetch errors.
- Consider IndexNow for fast-changing event URLs only after the canonical inventory and sitemap are correct.

### Structured-data rules

- JSON-LD must describe the main content visible on the same page.
- Structured data does not compensate for missing visible content or weak indexing fundamentals.
- Emit only accurate required properties and high-confidence recommended properties.
- Use absolute canonical URLs and crawlable image URLs.
- Validate representative examples before rollout and monitor enhancement reports after release.
- A change in an event's state updates both visible content and structured data in the same data flow.
- Do not publish fake reviews, ratings, attendance, offers, or availability.

Event eligibility gate:

- The page focuses on one real event and has a unique canonical leaf URL.
- The event is available to the public under Google's event-content rules.
- The event has an accurate name and a start date with the correct time-zone offset.
- A physical event has a real `Place` and sufficiently detailed address information.
- A virtual-only event is not marked up for Google's event experience under the current guidance.
- Cancellation and rescheduling retain the original identity and dates while using the appropriate event status.
- Multiple ticketed performances are represented according to Google's occurrence guidance rather than flattened into a misleading single event.
- Offers are included only when price, currency, availability, and destination are known and visible.
- The organizer and image are included only when the values are accurate and crawlable.

Do not emit Event structured data for every database row by default.
The current event data model contains records that will fail the public-attendance, location, description, image, or duplication gates.

Other structured-data priorities:

1. Add `Organization` or the best supported subtype for Wat2Do on one canonical brand page.
2. Add `WebSite` identity data on the canonical brand home when it accurately describes the site.
3. Add `BreadcrumbList` to public detail pages once the visible breadcrumb hierarchy exists.
4. Add organization-page semantic markup only when it accurately represents the student organization and does not imply ownership or affiliation by Wat2Do.

### Image and social-preview rules

- Every important public page has a useful Open Graph and Twitter image.
- Event pages prefer a relevant event image and use a consistent school-branded fallback when one is unavailable.
- Organization pages prefer the organization's approved logo or a school-branded fallback.
- Default share images should be landscape, readable at small sizes, and free of tiny text.
- Image URLs must be public, stable, crawlable, and served with the correct content type.
- Visible images use descriptive alt text when they communicate content and empty alt text when they are decorative.
- Declare image dimensions or preserve aspect ratio so media does not cause layout shift.
- Do not use a generic logo as the default structured-data event image when a relevant image is available.

### Performance rules

- Measure real-user performance by page type and device before optimizing isolated lab scores.
- At the 75th percentile, target LCP at or below 2.5 seconds, INP below 200 milliseconds, and CLS below 0.1.
- Protect the event poster or other likely LCP element from unnecessary lazy loading and unstable dimensions.
- Keep public landing pages usable before all account, analytics, and personalization code finishes loading.
- Do not delay indexable content behind application-readiness state that is unrelated to the public page.
- Treat server response reliability, cache behavior, and rendering cost as part of crawlability for a frequently changing event inventory.
- Do not chase a perfect Lighthouse score when field data and search outcomes show no meaningful problem.

### Internationalization rules

- Do not add `hreflang` until each language has a stable, independently crawlable URL with equivalent translated content.
- A client-side language preference on the same URL is not a sufficient alternate-language architecture.
- When language URLs exist, each page must self-canonicalize within its language and reference all true alternates, including itself.
- Do not auto-redirect crawlers solely by detected language or location.
- The HTML `lang`, visible language, title, description, and structured data must agree.

## Indexation matrix

This matrix is the intended default policy and must be finalized before implementation.

| Surface | Default policy | Canonical policy | Required quality gate |
| --- | --- | --- | --- |
| Root `/` | Decision required | Unique global brand page, or permanent redirect to the default school | Must not duplicate a school feed |
| School home `/` | Index | Self on the owning school host | Server-rendered heading, intro, current event links, unique school metadata |
| `/events/{id}` | Conditional index | Self on the event's school host | Valid event, unique record, useful visible data, correct 200 or 404 behavior |
| `/organizations` | Index | Self on the owning school host | Server-rendered directory, crawlable pagination, unique school metadata |
| `/organizations/{id}` | Conditional index | Self on the organization's school host | Approved public organization with useful visible data |
| `/promote` | Conditional index | One global canonical or meaningfully school-specific canonical | Program active, public, substantial content, no duplicate subdomain copies |
| `/contact` | Index only on the chosen brand host | One global canonical | Useful support and brand information |
| Search, sort, and filter parameters | No index by default | Canonical to the unfiltered directory when content is substantially duplicate | Dedicated pages require proven demand and unique value |
| Login, auth callback, onboarding, settings | No index | None | Must remain reachable to users |
| Admin, diagnostics, marketing operations | No index | None | Access control remains primary protection |
| Organization panel and poster dashboard | No index | None | Access control remains primary protection |
| Event submission and organization creation | No index | None | Product workflow, not a search destination |
| QR and invite routes | No index | None | Redirect or workflow utility |
| Design-system and demo routes | No index | None | Internal development surface |
| `all` host | No index | None | Administrative lens only |
| Unknown school host | No index and correct error or redirect policy | None | Must not become a duplicate default-school host |
| Missing event or organization | 404 or 410 | None | No client-only soft error |
| Cancelled event | Conditional index | Existing event canonical | Clear visible cancellation and accurate status data |
| Past event | Conditional index | Existing event canonical | Keep indexed only when the page retains unique user value or links |

## Page-type contracts

### School event feed

Search job: answer what is happening at a specific school now and soon.

Required elements:

- A server-rendered H1 with the full school name and event intent.
- A short, factual introduction explaining inventory coverage and freshness.
- Crawlable links to current event details.
- A visible route to the school organization directory.
- Unique school title, description, canonical, Open Graph URL, and social image.
- A clear empty-state policy that does not index a permanently empty school.
- Filter interactions that do not create uncontrolled indexable URL combinations.

### Event detail

Search job: help a student decide whether and how to attend one event.

Required elements:

- A server-rendered event name as H1.
- Human-readable occurrence dates, local time zone, location, organizer, cost, registration state, and cancellation state when known.
- Source attribution and a direct source link.
- A stable canonical on the event's owning school host.
- Page-specific title, description, social image, and Open Graph URL.
- A crawlable organizer link and related-event links when relevant.
- A real 404 or 410 for missing records.
- Event JSON-LD only when the eligibility gate passes.

### School organization directory

Search job: help a student discover clubs and student organizations at one school.

Required elements:

- A server-rendered H1 and short school-specific introduction.
- Crawlable links through all indexable directory pages.
- Descriptive organization names as anchor text.
- Unique school title, description, canonical, and social preview.
- Filter and pagination rules that prevent infinite crawl spaces.

### Organization detail

Search job: explain what an organization is and show how to engage with it.

Required elements:

- A server-rendered organization name as H1.
- School, category, verified social links, website, and description when known.
- Current event links and a useful empty state.
- A stable canonical on the organization's owning school host.
- Page-specific title, description, social image, and Open Graph URL.
- Clear source and affiliation language so Wat2Do does not imply it owns the organization.
- A real 404 or 410 for missing or non-public records.

## Prioritized backlog

Sequence matters more than the raw score.
Measurement and URL ownership decisions come before expansion.

### P0: establish control and remove indexation ambiguity

- [ ] Verify a Google Search Console Domain property for `wat2do.io` and confirm access for the owner.
- [ ] Verify Bing Webmaster Tools and import the Google Search Console property where appropriate.
- [ ] Export a 16-month baseline of clicks, impressions, click-through rate, queries, pages, countries, devices, and search appearance.
- [ ] Segment the baseline into brand, school home, event detail, organization directory, organization detail, and other routes.
- [ ] Record indexed and non-indexed counts plus the top exclusion reasons.
- [ ] Decide the one canonical role of `wat2do.io` versus `uwaterloo.wat2do.io`.
- [ ] Confirm whether an event or organization is currently reachable on multiple school hosts and choose the owning-host redirect rule.
- [ ] Implement the indexation matrix for public, private, utility, invalid-host, and administrative routes.
- [ ] Return real HTTP 404 or 410 statuses for missing events, missing organizations, and invalid public resources.
- [ ] Serve `robots.txt` and a canonical sitemap from each public host.

Definition of done:

- Search Console and Bing can fetch the declared sitemap without errors.
- Every sampled URL's status, robots directive, canonical, sitemap membership, and host agree with the matrix.
- No private or administrative route is intentionally indexable.
- No invalid resource returns an HTTP 200 error shell.

### P0: make the valuable inventory fully renderable

- [ ] Server-render the primary visible content for school feeds, event details, organization directories, and organization details.
- [ ] Reuse the same server-fetched entities for metadata, visible content, and client hydration.
- [ ] Ensure public content does not wait on authentication, personalization, browser storage, or general application-ready state.
- [ ] Expose crawlable links from school feeds to event details and from directories to organization details.
- [ ] Verify representative initial HTML with JavaScript disabled at the request level and with Search Console URL Inspection.

Definition of done:

- The initial response contains the H1, primary facts, and important internal links for each public page type.
- Users and crawlers receive the same facts.
- Hydration does not replace the initial content with a conflicting empty or loading state.

### P0: make every search result page-specific

- [ ] Define one server-side metadata builder or existing shared owner for canonical URL, title, description, Open Graph, Twitter, and robots fields.
- [ ] Generate school-specific metadata for the event feed and organization directory.
- [ ] Generate entity-specific metadata for event and organization details.
- [ ] Remove the client-side document-title path as an SEO source of truth once route metadata owns the behavior.
- [ ] Add self-referencing canonicals to every indexable page.
- [ ] Ensure Open Graph URLs match canonical URLs.
- [ ] Add a useful default social image and page-specific images where data quality permits.

Definition of done:

- Representative raw HTML contains exactly one correct title, description, robots directive, canonical, and Open Graph URL.
- Shared links to an event or organization produce a recognizable preview.
- No public detail page falls back to `Wat2Do | Campus Events` when entity data is available.

### P1: ship trustworthy discovery and structured data

- [ ] Define the event indexability and structured-data eligibility function from existing event fields.
- [ ] Establish a location normalization path that can produce truthful place and postal-address data without guessing.
- [ ] Establish duplicate-event detection and one canonical record for the same real-world event.
- [ ] Add visible source, organizer, update, cancellation, and attendance information to the event content contract.
- [ ] Roll out Event JSON-LD only to eligible pages and validate samples in the Rich Results Test.
- [ ] Add visible breadcrumbs and matching `BreadcrumbList` data to public detail pages.
- [ ] Add canonical Wat2Do `Organization` or appropriate subtype data on one brand page.
- [ ] Monitor Search Console enhancement reports and remove markup from records that do not remain compliant.

Definition of done:

- Structured data matches visible content exactly.
- Required properties validate with no critical errors on sampled eligible pages.
- Ineligible records emit no misleading Event markup.
- Cancelled or rescheduled events update through the same source of truth as the page.

### P1: improve content value and internal authority

- [ ] Add a short school-specific introduction to the event feed and organization directory.
- [ ] Ensure every indexable event explains enough for a student to decide whether to attend.
- [ ] Ensure every indexable organization explains what it is, where it belongs, and how to engage.
- [ ] Link events to organizers, organizers to current events, and details to genuinely related pages.
- [ ] Add crawlable pagination or another finite discovery path for all important event and organization URLs.
- [ ] Add source attribution and correction paths for scraped or community-submitted information.
- [ ] Create an organization share kit that encourages clubs to link to their canonical Wat2Do profile and events.
- [ ] Seek a small number of editorially earned links from student associations, school directories, campus publications, and participating organizations.

Definition of done:

- No indexable page is orphaned.
- Every indexable page offers material utility beyond the source social post.
- Backlink outreach is relevant and editorial, with no paid links or mass directory submissions.

### P1: measure page experience and conversion

- [ ] Capture search landing sessions by canonical page type in the existing analytics path.
- [ ] Define one primary conversion and a small set of guardrails for each public page type.
- [ ] Monitor field LCP, INP, and CLS at the 75th percentile by template and device.
- [ ] Investigate the highest-reach poor Core Web Vitals group before isolated page tuning.
- [ ] Annotate major SEO releases in the measurement log.

Suggested conversion map:

| Landing page | Primary conversion | Secondary signals |
| --- | --- | --- |
| School event feed | Event detail view | Filter use, save, newsletter sign-up |
| Event detail | Registration or source click | Save, calendar add, share, related event view |
| Organization directory | Organization detail view | Search or category engagement |
| Organization detail | Website, social, Discord, or current event click | Save or claim action |
| Promoter page | Enrollment start or sign-in return | Terms view, poster-program exploration |

### P2: expand only where data proves demand

- [ ] Identify non-branded queries with meaningful impressions and average positions from 4 through 20.
- [ ] Improve titles, headings, descriptions, and visible content on the already-ranking canonical page before creating a new page.
- [ ] Test a small number of school-specific category or time-window landing pages only when query demand and inventory depth are durable.
- [ ] Compare each test against a matched baseline and stop pages that create impressions without qualified clicks or product actions.
- [ ] Consider IndexNow for event publication, material updates, cancellations, and deletion after the core sitemap path is reliable.
- [ ] Add stable translated URLs and `hreflang` only when translated public content has an owner and monitoring plan.
- [ ] Consider descriptive slugs only if user clarity or search data shows material value.

If descriptive slugs are adopted, replace the ID-only public URL path rather than maintaining two live canonical schemes.
Old URLs must permanently redirect in one hop, and all internal links and sitemaps must change in the same release.

## High-ROI heuristics for weekly prioritization

Use these rules when deciding what to do next:

1. Fix an indexation blocker across an existing valuable page type before publishing new SEO content.
2. Improve a page already receiving non-branded impressions before targeting an unproven query.
3. Improve templates that affect hundreds of good pages before hand-tuning one low-demand page.
4. Fix incorrect titles, canonicals, statuses, or rendering before adding structured data.
5. Improve source-data completeness before generating copy around missing facts.
6. Build internal links from pages with real traffic before chasing weak directory backlinks.
7. Prefer an earned link from a relevant campus authority over dozens of generic listings.
8. Prefer one complete, maintained landing page over ten thin keyword variants.
9. Use Search Console impressions and query patterns to discover demand, then use product analytics to judge value.
10. Stop an experiment that increases crawl volume without qualified clicks or downstream actions.

## Low-ROI and harmful work to avoid

- Do not add meta keywords.
- Do not buy links, exchange links at scale, or submit Wat2Do to low-quality directories.
- Do not publish mass AI-written campus guides or mechanically rewritten source posts.
- Do not create a page for every combination of school, category, date, price, food, and registration filter.
- Do not keyword-stuff titles, headings, alt text, event descriptions, or organization names.
- Do not add structured data that is invisible, incomplete, inaccurate, or unrelated to the page.
- Do not add fake FAQ sections solely to emit FAQ markup.
- Do not treat a sitemap as a replacement for internal links.
- Do not block duplicate URLs in `robots.txt` and assume they will disappear from the index.
- Do not chase Domain Authority or another vendor metric as a product goal.
- Do not chase a perfect Lighthouse score while ignoring field performance and search conversions.
- Do not prioritize `llms.txt` or another speculative crawler file ahead of standard crawlability, canonicalization, structured data, and helpful content.
- Do not create a blog until there is a clear audience job, an editorial owner, and evidence that the content will add original campus value.

## Measurement scorecard

Maintain the scorecard monthly by school and page type.

### Acquisition metrics

- Non-branded impressions.
- Non-branded clicks.
- Organic click-through rate.
- Unique organic landing pages receiving clicks.
- Search appearance counts for valid enhancements.
- Indexed canonical URLs divided by submitted eligible URLs.

### Product metrics

- Event detail views from organic landings.
- Registration or source-link clicks from organic event landings.
- Saves, calendar adds, shares, and newsletter sign-ups from organic sessions.
- Organization detail and outbound engagement from organic sessions.
- Organic landing conversion rate by page type and school.

### Quality guardrails

- Soft 404s and invalid 200 responses.
- Duplicate without user-selected canonical.
- Crawled or discovered but not indexed by page type.
- Sitemap fetch or parsing errors.
- Invalid structured-data items.
- Public-page HTTP 5xx and p95 server response time.
- Field LCP, INP, and CLS at the 75th percentile.
- Bounce or short-session changes where they meaningfully indicate unsatisfied intent.

Do not combine all page types into one success number.
An event detail page and a directory page have different jobs, lifetimes, and conversion paths.

## SEO experiment template

Copy this section for any non-trivial SEO experiment.

### Experiment name

Status: proposed.
Owner: unassigned.
Start date: unassigned.
Review date: unassigned.

Hypothesis:

> If we change [specific page template or rule] for [eligible URL cohort], then [primary metric] will improve because [user or crawler reason].

Scope:

- Page type:
- School or host:
- Eligible URLs:
- Excluded URLs:
- Search intent:

Measurement:

- Primary metric:
- Secondary metrics:
- Guardrails:
- Baseline period:
- Comparison method:
- Expected evaluation window:

Decision:

- [ ] Keep.
- [ ] Iterate.
- [ ] Revert.
- [ ] Inconclusive.

Result and follow-up:

> Record the outcome, limitations, and next action here.

## Release checklist for future SEO changes

### Before implementation

- [ ] Identify the page type, search intent, and canonical owner.
- [ ] Record the current Search Console and product baseline.
- [ ] Score impact, confidence, reach, and effort.
- [ ] Confirm that the change reuses the existing server data and route architecture.
- [ ] Confirm the indexation matrix and data-quality gate.
- [ ] Identify all host, sitemap, metadata, analytics, and HTTP-status effects.

### Before release

- [ ] Inspect raw initial HTML, not only the hydrated browser DOM.
- [ ] Verify one valid page, one invalid page, one duplicate-host request, and one private page.
- [ ] Confirm title, H1, description, canonical, robots, Open Graph URL, and social image.
- [ ] Confirm important links are crawlable and use canonical destinations.
- [ ] Confirm sitemap membership agrees with status, robots, and canonical output.
- [ ] Validate structured data when present.
- [ ] Run the repository tests, typecheck, lint, and non-browser checks.
- [ ] Leave browser-based and Search Console inspection steps for the human when the repository policy requires it.

### After release

- [ ] Inspect representative live URLs in Search Console.
- [ ] Resubmit the sitemap only when necessary and confirm it remains fetchable.
- [ ] Monitor indexing, enhancements, errors, clicks, and impressions.
- [ ] Compare the defined product conversion and guardrails.
- [ ] Update this playbook's backlog, decision log, and experiment result in the same follow-up change.

## Maintenance routine

### Weekly

- Review Search Console for manual actions, security issues, sitemap errors, sudden indexing changes, and large click or impression changes.
- Review new high-impression, low-click queries and pages.
- Check newly published or materially changed events for crawl and index discovery when timeliness matters.
- Triage any new soft 404, duplicate, or server-error pattern.

### Monthly

- Update the scorecard by school and page type.
- Re-rank the backlog with current evidence.
- Sample titles, descriptions, canonicals, initial HTML, statuses, internal links, and structured data.
- Review content-quality failures and the percentage of events eligible for indexing and Event markup.
- Review Core Web Vitals groups and search landing conversion.
- Update `Last updated` and record material decisions below.

### Quarterly

- Re-read the linked first-party guidance for changes.
- Review the indexation matrix and canonical host strategy.
- Audit orphan pages, duplicate events, URL parameters, redirects, and sitemap freshness.
- Review competitor and campus search results manually to identify unmet user needs, not copy their tactics.
- Remove obsolete TODOs, experiments, schema, landing pages, and measurements.

## Decision log

| Date | Decision | Evidence | Owner | Revisit when |
| --- | --- | --- | --- | --- |
| 2026-08-02 | Keep one version-controlled SEO playbook under `docs/` and link it from the repository README. | SEO rules and implementation TODOs need one maintainable source of truth. | Tony | The operating-document convention changes. |
| Unresolved | Choose whether the root host is a unique brand page or redirects to the default school. | The current root and Waterloo host can serve the same default-school experience. | Tony | Before canonical and sitemap implementation. |
| Unresolved | Define the event indexability and Event structured-data eligibility gate. | Current event records vary in public eligibility, location detail, descriptions, images, and duplication. | Tony | Before event sitemap or JSON-LD rollout. |

## Primary references

These links are the baseline for future updates to this playbook.

- [Google Search Essentials](https://developers.google.com/search/docs/essentials)
- [Google's developer SEO guide](https://developers.google.com/search/docs/fundamentals/get-started-developers)
- [Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
- [JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Crawlable link guidance](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)
- [Faceted navigation guidance](https://developers.google.com/crawling/docs/faceted-navigation)
- [Title-link guidance](https://developers.google.com/search/docs/appearance/title-link)
- [Meta-description and snippet guidance](https://developers.google.com/search/docs/appearance/snippet)
- [General structured-data guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [Event structured-data guidance](https://developers.google.com/search/docs/appearance/structured-data/event)
- [Organization structured-data guidance](https://developers.google.com/search/docs/appearance/structured-data/organization)
- [Breadcrumb structured-data guidance](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)
- [Core Web Vitals and Search](https://developers.google.com/search/docs/appearance/core-web-vitals)
- [Search Console Performance report tasks](https://support.google.com/webmasters/answer/17010961?hl=en)
- [Search Console Page indexing report](https://support.google.com/webmasters/answer/7440203?hl=en)
- [Bing IndexNow guidance](https://www.bing.com/webmasters/help/indexnow-0z209wby)
- [Next.js `generateMetadata`](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)
- [Next.js sitemap convention](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap)
