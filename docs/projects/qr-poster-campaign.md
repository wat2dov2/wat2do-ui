# Project: Wat2Do Promoter Poster Program

Status: backend foundation implemented; promoter and administrator product surfaces planned.
Owner: Tony.
Last updated: July 28, 2026.

## One-line architecture

Promoters are ordinary Wat2Do users with enrollment fields, promoter posters are marked rows in the existing `qr_codes` table, scans use privacy-preserving visitor identifiers, earnings are derived from confirmed scans, monthly money movements are recorded only in `poster_payouts`, and the product surface is a recruitment page, a promoter dashboard, and administrator payout operations.

## Product outcome

Wat2Do recruits students to place official Wat2Do posters around their campus.
An eligible student enrolls instantly, chooses an approved poster design, generates one uniquely attributed QR poster per physical placement, activates it after placement, and earns $0.25 for each qualifying new visitor after the activation scan.

The product must make three facts immediately clear:

1. Wat2Do supplies the approved designs.
2. Each physical poster has its own QR code and measurable location.
3. Payments are based on qualifying visitors, not every raw scan request.

## Goals

- Make it possible for an eligible student to enroll and create a poster without administrator assistance.
- Keep the promoter program inside the existing QR code system.
- Provide official, reliable, print-ready poster designs.
- Attribute confirmed visitors without storing raw IP addresses.
- Show promoters understandable poster performance and payout history.
- Give administrators a safe monthly review and payment workflow.
- Allow the program to be paused without breaking existing QR redirects.
- Support multiple schools without creating a campaign entity for every campus.

## Explicit non-goals

- No separate promoter entity.
- No `poster_campaigns` table.
- No parallel promoter QR tables or scan pipeline.
- No live earnings ledger.
- No points, levels, missions, badges, or public leaderboard.
- No live scan feed for promoters.
- No promoter-uploaded creative.
- No automated Interac payment integration.
- No public owner names, payout details, fraud details, or raw scan history.
- No multiple physical placements sharing one QR code.

## Locked product decisions

### Enrollment

- Enrollment is instant for an authenticated user with a school.
- Enrollment requires a payout email and acceptance of the current promoter Terms of Service.
- Wat2Do does not ask for an application essay, graduation year, social profiles, or a second account.
- Discord is strongly encouraged for support but is not required for enrollment.
- A user whose accepted Terms of Service version is stale must accept the current version before creating another promoter poster.

### Compensation

- The rate is $0.25 per creditable visitor.
- The first confirmed unique visitor for each poster is the activation scan and earns $0.
- A visitor can earn credit only once per poster.
- Earnings are calculated from confirmed scan rows and are not written to a live ledger.
- Payout periods are UTC calendar months.
- The stated payment day is the first day of each month.
- Payouts are prepared on the first day of the following month without an additional close delay.
- Every positive pilot balance is payable, with no minimum payout threshold.
- Held payouts are reviewed rather than silently removed.
- The pilot uses manual Interac e-Transfers.

### Poster ownership and physical placement

- One QR code represents one physical poster placement.
- A user who wants five physical posters creates five poster rows and receives five unique QR codes.
- A multi-copy generation action may create several posters at once, but every output page must contain a different QR code.
- Promoter posters cannot be permanently deleted through the product.
- Promoters do not receive a self-service active-state or retirement action.

### Creative

- Promoters choose only from a curated library of approved Wat2Do poster images.
- Every approved image contains a reserved blank QR area.
- Wat2Do overlays the poster-specific QR into that area during generation.
- Promoters cannot upload or position their own creative.
- A promoter who wants to suggest a custom design is directed to the Wat2Do Discord.
- Tony manually reviews submitted designs and adds approved designs to the official library through a normal code and deployment change.
- There is no asset-submission table, moderation queue, or administrator template editor.

### Map and privacy

- The recruitment page may show approximate campus coverage without authentication.
- The promoter dashboard shows the user's own placements precisely and other campus coverage in a muted, approximate form.
- Other promoters' names, poster identifiers, exact coordinates, and exact earnings are never exposed.
- Promoters see aggregate poster performance, not raw promoter scan rows or fraud signals.
- Administrators retain access to the scan and risk information required for payout review.

## Product terminology

`is_active` remains the generic QR lifecycle field shared by standard and promoter QR codes.
New promoter posters are active, and the promoter earnings response contains active rows only.
Historical inactive promoter rows still resolve to their destination but do not record another scan.
The promoter UI must not call a poster inactive merely because it has not received a recent scan.

The promoter UI derives these labels:

| Label | Derivation | Meaning |
| --- | --- | --- |
| Not placed | Poster without a usable map location | The poster was generated but its placement has not been located |
| Recently scanned | Placed poster with `latest_scan` within 30 days | The poster has received accepted traffic recently |
| Quiet | Placed poster with no accepted scan in 30 days | The poster still redirects but may no longer be visible |

The 30-day quiet threshold belongs in the promoter program control box.

## Approved poster template system

### Template source of truth

Approved template metadata belongs in the existing `backend/controlbox/promoter_program.json` feature control file.
The implementation must not create a second template registry in the frontend.

Each template entry contains:

- A stable template ID.
- A user-facing name.
- A stable version-controlled asset path.
- Its eligible school or a global marker.
- Print size and orientation.
- Normalized QR placement coordinates.
- A preview description.
- Whether it is available for new poster creation.

The frontend may import the specific promoter program control file as allowed by the repository control-box policy.
The backend validates that the selected template exists, is enabled for creation, and is eligible for the user's school.

Retired templates remain in the registry with creation disabled.
This allows an existing poster to be regenerated after its template is removed from the new-poster gallery.

### Template requirements

- Initial formats are US Letter portrait PDF and high-resolution PNG.
- Every design includes an obvious blank QR zone with a white background.
- The rendered QR includes its required quiet zone and high contrast.
- The template includes a short scan call to action.
- The template uses evergreen copy and does not contain event dates.
- Printed acceptance samples must scan reliably from at least 1.5 metres under ordinary indoor lighting.
- The initial library includes at least one colour design, one black-and-white design, and one low-ink design.

### Custom design requests

The template gallery ends with a small secondary card:

> Have your own poster design?
> Join our Discord and share it with us.
> We will review it and add approved designs to the official collection.

The CTA links to `https://discord.gg/uVcZcp4q8R`.

Manual review checks:

- Wat2Do branding and truthful messaging.
- Copyright and asset ownership.
- School appropriateness.
- Print resolution.
- QR contrast, size, and quiet zone.
- Whether the design is global or school-specific.

## End-to-end promoter journey

### 1. Recruitment banner

The authenticated event feed uses a shadcn Alert primitive as the recruitment banner.
The primitive is extended through the existing design system rather than implemented as a bespoke page-level style.

Recommended copy:

> Help more students discover events at [School].
> Put up official Wat2Do posters and earn 25 cents for every qualifying new visitor.

The CTA is `See how it works`.

Banner behavior:

- The entire banner links to `/promote`.
- Eligible unenrolled users may dismiss it for 30 days.
- Enrolled promoters do not see it.
- The banner is not shown when the promoter program is paused.
- The copy uses `qualifying new visitor`, not `scan`.

### 2. Public recruitment page

Route: `/promote`.

The page is public so a visitor can understand the opportunity before signing in.

Desktop composition:

- School-specific value proposition and three-step explanation.
- Campus coverage map on the left.
- Sticky enrollment card on the right.

Mobile composition:

- Value proposition first.
- Enrollment card second.
- Coverage map third.

The three steps are:

1. Choose an official poster.
2. Place and activate it on campus.
3. Earn 25 cents when it brings a qualifying visitor.

Enrollment-card states:

| State | Primary behavior |
| --- | --- |
| Logged out | Active `Sign in to join` CTA that returns to `/promote` |
| Logged in and unenrolled | Payout email, scroll-gated Terms dialog, and `Join the program` CTA |
| Enrolled | Confirmation and `Open my posters` CTA |
| Program paused | Paused notice without enrollment or creation controls |
| Missing school | Explanation and link to complete the user's school profile |

A logged-out visitor receives an active sign-in action rather than a disabled enrollment button.

Trust copy appears beside the enrollment form:

- Payments are sent by Interac e-Transfer on the first day of each month.
- The activation scan earns $0.
- Duplicate, unconfirmed, automated, and fraudulent traffic is excluded.
- Wat2Do does not store raw IP addresses.
- Discord is available for program help.

### 3. Enrollment

The existing user enrollment endpoint updates the user's payout email and stamps the current Terms of Service version.
Successful enrollment takes the user directly to `/posters`.

The current `2026-07` Terms are shown in a dialog rather than a standalone page.
The accept action remains disabled until the user scrolls to the end.
The Terms state the explicit program rate, the first-day payment date, the five-second landing requirement for a valid scan, the dispute process, and the privacy protections used to measure poster areas.

The Settings page retains a `Promoter program` section for:

- Reviewing enrollment status.
- Editing the payout email.
- Accepting a newly published Terms of Service version.
- Opening the promoter dashboard.
- Opening the Discord support channel.

### 4. Poster dashboard

Route: `/posters`.

The floating dock contains a poster icon for every visitor.
A signed-out or unenrolled user selecting it goes to `/promote`.
An enrolled user selecting it goes to `/posters`.
The icon is active on both promoter routes.

The dashboard summary contains:

- Pending earnings for the current month.
- Creditable visitors for the current month.
- Unqualified scan attempts for the current month.
- Lifetime paid amount.
- Active poster slots used out of 50.

The dashboard summary uses a fixed two-column grid at every breakpoint.
The dashboard labels its scan-derived values as updated daily.
It does not present a real-time scan feed.

Desktop layout:

- Owned-poster inventory first.
- Campus map below the poster inventory.
- Payout history below the map.

Map behavior:

- Owned posters use solid, high-contrast markers.
- Other campus coverage uses muted aggregate markers at approximately 20 to 30 percent opacity.
- Owned markers open the corresponding poster summary.
- Other promoters' markers are not individually clickable.
- The map does not expose another user's exact scan count or earnings.

Every poster card or row shows:

- Poster name.
- Template preview.
- Placement state.
- Total confirmed unique visitors.
- Current-period creditable visitors.
- Current-period earnings.
- Last scanned time.
- Download action.

The dashboard empty state says:

> Create your first official Wat2Do poster.
> Download it, place it on campus, and scan it yourself to activate the placement.
> The Activation scan earns $0.

The payout history table shows:

- Period.
- Creditable visitors.
- Rate.
- Amount.
- Status.
- Paid date.

### 5. Poster creation

The promoter creation flow replaces the current user-upload and draggable-placement experience for promoter posters.
The existing flexible asset wizard remains available only where organization and administrator QR workflows require it.

Promoter steps:

1. Choose an approved poster design from the school-eligible gallery.
2. Enter a recognizable placement name, such as `SLC second floor`.
3. Choose the number of independently tracked physical copies.
4. Preview each design with its real unique QR code.
5. Generate and download PDF or PNG output.
6. Place each poster and scan it to establish its location.

The template determines the QR placement.
The promoter cannot drag, resize, replace, or remove the QR area.

If the user chooses multiple copies:

- The backend creates one promoter `qr_codes` row per copy.
- Every row consumes one active slot.
- Every PDF page receives the QR for its corresponding row.
- Filenames or printed footers make the copies distinguishable.
- The entire operation fails cleanly if it would exceed the 50-poster cap.

The creation screen states:

> Each QR is for one physical location so Wat2Do can measure and map that poster accurately.

### 6. Placement activation

After a promoter places a poster, the dashboard instructs them to scan the printed QR and allow location access.
This deliberate owner scan verifies the printed asset and supplies the placement coordinates through the existing scan route.

The scan route follows these rules:

- A historical inactive QR still resolves to its configured destination but does not record another scan.
- The poster's first confirmed unique visitor is the non-creditable activation scan.
- The first accepted scan with usable coordinates sets the poster location when the poster is not yet placed.
- A scan without coordinates still redirects successfully.
- A later accepted scan may set the location if the poster still has no usable coordinates.
- Once set, ordinary scans do not move the poster.

### 7. Visitor scan

A public visitor scans `/qr/{id}`.
The backend records an accepted scan, creates a short-lived landing confirmation token, and redirects to the creating user's school event feed.

The redirect adds:

- `utm_source=poster`.
- `poster_id={qr_code_id}`.

The destination surface confirms the scan only after the configured landing delay.
Only confirmed visits participate in earnings.
The visitor is never required to create an account.

## Earnings definition

The stable visitor identifier is an HMAC of a long-lived anonymous first-party visitor cookie.
The client IP is separately HMAC-hashed for fraud analysis.
The detailed user-agent header is discarded after coarse browser and operating-system families are derived.
Raw IP addresses and raw user-agent strings are never stored.

For each poster:

1. Consider only scans with `landing_confirmed_at`.
2. Group by `dedupe_hash`.
3. Treat the first confirmed occurrence of each hash as that visitor's unique visit to the poster.
4. Count a visitor in a payout period only when that first confirmed occurrence falls inside the period.
5. Subtract one if the poster's first confirmed unique visitor falls inside that period.
6. Floor the result at zero.
7. Multiply the creditable visitor count by the configured rate in integer cents.

Monthly scan attempts count every accepted scan row recorded for currently active promoter posters during the UTC payout period.
Current-period unqualified scans equal those attempts minus current-period creditable unique scans, floored at zero.
This makes activation, duplicate, and unconfirmed scan attempts visible without making them payable.
The dashboard exposes active promoter rows only.

The poster's `latest_scan` timestamp updates for every accepted scan, including a repeat visitor that is not creditable.
This keeps recency independent from earnings eligibility.

## Final data model

Existing scan rows are intentionally discarded when the privacy-preserving scan schema is introduced.
There is no backfill or compatibility path for legacy scan rows.

### `qr_code_scans`

Removed columns:

- `user_id`.
- `session_id`.
- `conversion_actions`.
- Raw `user_agent`.

Final promoter-relevant columns:

| Column | Purpose |
| --- | --- |
| `id` | Scan UUID |
| `qr_code_id` | Existing QR code foreign key |
| `scanned_at` | Accepted scan timestamp |
| `dedupe_hash` | HMAC visitor identifier used for uniqueness |
| `ip_hash` | Separate HMAC IP signal used only for risk analysis |
| `browser_family` | Coarse browser family |
| `os_family` | Coarse operating-system family |
| `asn` | Optional network ASN captured at record time |
| `country` | Optional two-letter country code captured at record time |
| `landing_confirmed_at` | Proof that the visitor remained through the landing delay |
| `risk_score` | Deterministic risk score |
| `risk_flags` | Structured risk reasons |
| `risk_evaluated_at` | Risk evaluation timestamp |
| `risk_rules_version` | Version of the rules used |

Required indexes cover:

- QR code plus descending scan time.
- QR code plus dedupe hash.
- Dedupe hash plus scan time.
- IP hash plus scan time.
- Confirmed earnings scans by QR code, dedupe hash, and scan time.

### `qr_codes`

Promoter extensions:

| Column | Purpose |
| --- | --- |
| `program` | `standard` or `promoter` |
| `latest_scan` | Automatically updated timestamp for the latest accepted scan |
| `poster_template_id` | Stable approved template selection for promoter posters |

Existing fields retain these meanings:

- `created_by` owns the promoter poster.
- `is_active` is the shared QR lifecycle state used by standard QR management and retained historical rows.
- `latitude` and `longitude` hold the physical placement when known.
- `filters.school` selects the school event feed.
- `image_url` may expose the approved template preview resolved by the server.

`poster_template_id` is nullable for standard QR codes and required for newly created promoter posters.
It is validated against the promoter program control box rather than a separate database table.

### `users`

Promoter enrollment fields:

- `payout_email`.
- `promoter_tos_accepted_at`.
- `promoter_tos_version`.

The three fields are either all populated or all null.

### `poster_payouts`

| Column | Purpose |
| --- | --- |
| `id` | Payout UUID |
| `user_id` | Promoter receiving the payout |
| `period` | First day of the closed UTC month |
| `payout_email` | Historical email snapshot used for this payout |
| `rate_cents` | Historical rate snapshot |
| `amount_cents` | Integer payout amount |
| `scan_count` | Creditable visitor count |
| `status` | `pending`, `held`, `paid`, or `voided` |
| `paid_at` | External payment timestamp |
| `notes` | Hold, void, or review explanation |
| `reviewed_by` | Administrator who performed the review action |
| `created_at` | Creation timestamp |
| `updated_at` | Last update timestamp |

The table has a unique constraint on `(user_id, period)`.
The amount must equal `rate_cents * scan_count`.
Held and voided rows require non-empty notes.
Paid rows require `paid_at`.

## API contract

### Existing and extended QR routes

| Route | Contract |
| --- | --- |
| `GET /qr/{id}` | Record an accepted scan, update `latest_scan`, capture first usable placement coordinates, issue a landing confirmation token for promoter scans, and return redirect configuration |
| `POST /qr/scans/confirm` | Confirm the landing after the configured delay using the visitor cookie and signed token |
| `GET /qr/` | List manageable QR codes with program, active-state, recency, and never-scanned filters |
| `POST /qr/` | Preserve organization and administrator creation while allowing enrolled users to create `program=promoter` posters |
| `PATCH /qr/{id}` | Preserve existing standard QR editing rules and prevent promoter ownership or program mutation |
| `GET /qr/earnings` | Return the authenticated promoter's per-poster and period aggregates |

Promoter creation requires:

- Current enrollment.
- A school on the user account.
- Program enabled.
- An enabled, school-compatible approved template.
- Fewer than 50 active promoter posters after the complete batch.
- The server-defined school event-feed destination.

The promoter client supplies `program=promoter` and `poster_template_id`.
It does not supply an arbitrary destination, school, QR placement, or promoter asset URL.

`GET /qr/earnings` returns:

- Current period.
- Owned poster rows.
- Exact owned placement coordinates.
- Template ID and preview.
- Lifetime confirmed unique visitors per poster.
- Current-period confirmed unique visitors per poster.
- Current-period creditable visitors per poster.
- Pending cents per poster.
- Total current-period creditable visitors.
- Total current-period unqualified scan attempts.
- Total pending cents.
- Lifetime paid cents.
- Active slots used and limit.
- Program-enabled state.

### Campus coverage map

New route: `GET /qr/map?school={school}`.

The public response contains only aggregated map cells:

- Rounded or clustered latitude and longitude.
- Poster count.
- Recent versus quiet poster count.
- A broad confirmed-visitor bucket.

The public response does not contain:

- QR code IDs.
- Owner IDs.
- Exact coordinates.
- Exact scan counts.
- Earnings.
- Fraud information.

The authenticated dashboard combines the public aggregate response with the exact owned-poster rows returned by `GET /qr/earnings`.

### User enrollment

| Route | Contract |
| --- | --- |
| `PUT /users/me/promoter-enrollment` | Validate payout email, require Terms acceptance when needed, and stamp the server-owned acceptance timestamp and version |

### Payout routes

| Route | Contract |
| --- | --- |
| `GET /payouts/` | Authenticated user lists only their own payout history |
| `GET /payouts/admin` | Administrator lists and filters payouts by user, period, and status |
| `GET /payouts/admin/{id}` | Administrator views payout details and fraud reasons |
| `PATCH /payouts/admin/{id}/status` | Administrator performs a valid reviewed status transition |
| `POST /payouts/admin/mark-paid` | Administrator marks selected pending payouts paid after external transfer |

Valid administrator transitions:

- `pending` to `held`, with notes.
- `pending` to `paid`.
- `held` to `pending`.
- `held` to `voided`, with notes.

No transition out of `paid` or `voided` is allowed.

## Monthly payout job

Job: `backend/jobs/run_poster_payouts.py`.

For a closed period, the job:

1. Reuses the shared earnings calculation.
2. Evaluates versioned fraud rules.
3. Creates or updates one non-paid `poster_payouts` row per user and period.
4. Sets safe rows to `pending`.
5. Sets flagged rows to `held` with structured reasons.
6. Excludes held and zero-value rows from the Interac CSV.
7. Emits payout email, amount, scan count, and status.
8. Leaves already paid rows unchanged on rerun.

The job records money that is ready for external settlement.
It does not send Interac transfers.

## Administrator experience

The existing Admin Posters route receives two explicit tabs:

- Posters.
- Payouts.

The payout table contains:

- Promoter.
- Payout email.
- Period.
- Creditable visitors.
- Rate.
- Amount.
- Status.
- Fraud indicator.
- Actions.

Selecting a row opens a detail drawer or dialog containing:

- Poster contribution breakdown.
- Fraud reason codes and evidence.
- Notes.
- Review history.
- Payout email.
- Period boundaries.
- Relevant timestamps.

Actions use explicit language:

- Hold payout.
- Release hold.
- Void payout.
- Mark as paid.

Before marking a payout paid, the UI states:

> Marking this payout as paid records an external Interac payment.
> Wat2Do will not send money automatically.

Bulk payment flow:

1. Filter to pending payouts.
2. Select the rows to pay.
3. Export the Interac CSV.
4. Send the transfers externally.
5. Mark the selected rows paid.

Held payouts must be resolved before they can be included in a bulk paid action.

## Program kill switch

When the promoter program control-box `enabled` value is false:

- Existing QR codes continue redirecting.
- Existing accepted scans may still be recorded.
- Earnings and payout history remain readable.
- New enrollment is blocked.
- New promoter poster creation is blocked.
- The recruitment banner is hidden.
- Enrolled users see a calm paused notice in their dashboard.

The paused state is not presented as a generic application error.

## Configuration and secrets

Non-secret promoter controls live only in `backend/controlbox/promoter_program.json`.

The control box owns:

- Program enabled state.
- Rate in cents.
- Maximum active posters.
- Landing confirmation delay.
- Confirmation token lifetime.
- Payment day of month.
- Quiet-poster threshold.
- Terms of Service version.
- Discord invite URL.
- Fraud-rule version and thresholds.
- Approved poster template metadata.

Runtime secrets include:

- `POSTER_HASH_SECRET`.
- `POSTER_CONFIRMATION_SECRET`.

Production infrastructure must also provide:

- Correct trusted-proxy handling for the real client IP.
- A production Mapbox token.
- Scheduled monthly execution of the payout job.
- Secure handling of generated Interac CSV files.
- Published and versioned promoter Terms content for the scroll-gated acceptance dialog.

Secrets never appear in control-box files, client bundles, logs, payout notes, or generated CSV output.

## Fraud and privacy controls

- Raw IP addresses are never stored.
- Raw user-agent strings are never stored.
- The anonymous visitor cookie is first-party, HTTP-only, secure in production, and scoped to the QR redirect path.
- Dedupe and IP hashes use domain-separated HMAC inputs.
- Landing confirmation prevents an immediate redirect request from becoming payable by itself.
- Risk rules are deterministic and versioned.
- Promoters do not receive raw promoter scan rows or fraud-rule details.
- Administrators can review structured fraud reasons before releasing or voiding a payout.
- A suspicious account is held before any void decision.

## Design principles

The interface follows the strongest recurring patterns from ambassador and QR-management products:

- Explain the value before presenting enrollment.
- Make compensation concrete and qualification rules visible.
- Show the next physical action clearly.
- Keep poster inventory primary and use the map as supporting context.
- Keep participant and administrator operations separate.
- Provide support where the physical work happens.
- Avoid points and gamification when cash is already understandable.
- Avoid long applications when fraud can be reviewed at payout time.

All new UI composes existing semantic tokens, UI primitives, and layout primitives.
The implementation adds or extends a shadcn primitive only when the design system lacks the required state.
Pages remain orchestration surfaces and do not own fetching, caching, asset generation, or payout-transition logic.

## Implementation sequence

### Phase 0: Backend foundation

Status: implemented.

- Privacy-preserving scan migration.
- Legacy scan-row wipe and removal of `user_id`.
- Promoter program marker and `latest_scan`.
- Enrollment fields and endpoint.
- Promoter QR creation authorization and 50-poster cap.
- Confirmed-scan earnings calculation.
- Payout table, services, routes, risk evaluation, and monthly job.
- Promoter program control box and backend tests.

### Phase 1: Approved template foundation

- Extend the promoter control box with approved template metadata.
- Add `poster_template_id` to `qr_codes` and API schemas.
- Add the initial version-controlled poster assets.
- Make template retirement preserve existing regeneration.
- Replace promoter upload and draggable placement with template selection.
- Keep existing organization and administrator asset flows unchanged.
- Generate one QR row and one unique output page per physical copy.

### Phase 2: Recruitment and enrollment

- Add the shadcn-based feed recruitment banner.
- Add the public `/promote` page.
- Add logged-out, unenrolled, enrolled, missing-school, and paused states.
- Extend Settings with the promoter enrollment section.
- Add Terms of Service and Discord links.
- Add the poster item to the public floating dock.

### Phase 3: Promoter dashboard and map

- Add the `/posters` promoter route and page container.
- Add earnings and payout-history queries using shared TanStack Query ownership.
- Add summary cards, poster inventory, lifecycle labels, downloads, and unqualified scan totals.
- Add the safe public school coverage endpoint.
- Extend the existing map implementation through one shared marker source of truth.
- Render owned markers precisely and public aggregate coverage approximately.
- Add deliberate placement instructions and coordinate capture.

### Phase 4: Administrator payout operations

- Add Posters and Payouts tabs to the administrator poster surface.
- Add payout list filters, statuses, row detail, and fraud reasons.
- Add hold, release, void, and mark-paid actions.
- Add pending-only bulk selection and CSV workflow.
- Add explicit external-payment confirmation copy.

### Phase 5: Production readiness

- Publish and version promoter Terms of Service.
- Verify production proxy IP handling without storing raw IP.
- Configure production secrets.
- Configure Mapbox.
- Schedule the monthly payout job.
- Print and test every initial template.
- Rehearse one normal payout and one held payout.
- Verify kill-switch behavior.
- Recruit a small closed pilot before public campus promotion.

## Acceptance criteria

### Promoter

- A public visitor can understand the offer without signing in.
- An eligible authenticated user can enroll with only payout email and Terms acceptance.
- An enrolled user can choose only an approved template.
- A custom-design request leads to Discord and never uploads a file to Wat2Do.
- Every physical copy receives a unique QR code.
- A generated poster can be downloaded as PDF or PNG.
- The placement scan records the first accepted visit and can establish map coordinates.
- The activation scan earns $0.
- A later confirmed unique visitor adds exactly 25 cents.
- A duplicate visitor does not add another credit for the same poster.
- The dashboard shows owned poster totals, current pending earnings, slot usage, and payout history.
- The promoter product exposes no poster retirement or deletion action.

### Privacy and map

- No raw IP or raw user-agent value is persisted or logged.
- A public map response cannot identify a promoter or exact poster location.
- A promoter sees exact information only for their own posters.
- Another promoter's coverage is visually muted and aggregated.
- Raw promoter scan and fraud details remain administrator-only.

### Administrator

- An administrator can filter payouts by period and status.
- A held payout displays structured reasons.
- Holding and voiding require notes.
- Invalid payout transitions are rejected.
- Pending payouts can be exported and bulk-marked paid.
- The UI makes clear that marking paid does not send money.
- A monthly job rerun cannot overwrite an already paid payout.

### Kill switch

- Pausing the program blocks new enrollment and creation.
- Existing QR redirects continue working.
- Existing dashboards and payout history remain readable.
- Promoters receive an intentional paused message.

## Required verification during implementation

Backend changes require the complete backend test suite.
Frontend changes require `npm run check` in `frontend/` for lint, i18n audit, and type-checking.
Generated API types must be refreshed whenever an API contract changes.
Tests must cover the frontend and backend agreement for every promoter request and response field.
End-to-end tests must cover enrollment, multi-copy creation, activation, dedupe, unqualified scan totals, payout review, and kill-switch behavior.
The human runs browser-dependent tests and the production physical-print scan test, in accordance with the repository browser and server policy.
