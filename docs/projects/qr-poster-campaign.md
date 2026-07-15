# Project: QR Code Poster Campaign

Status: planned (Jul 14 to Sep 3, 2026).
Owner: Tony.

## Brief

Launch a distributed QR poster program where students put up physical Wat2Do posters on campus, scans are tracked, and promoters earn $0.25 per unique scan per poster, paid monthly via Interac e-Transfer.
Live pilot at UWaterloo by Aug 25, first payout run Sep 1, repeatable multi-school playbook by Sep 3.

### Architecture decisions (locked)

1. Extend the existing QR system (`qr_codes`, `qr_code_scans`, `backend/routers/qr.py`, `backend/services/qr_code_service.py`, `frontend/src/features/posters`).
   Promoter posters are `qr_codes` rows with a `program` marker.
   No parallel tables or pipelines.
2. Scans are the source of truth; earnings are derived.
   A salted `dedupe_hash = sha256(salt, ip, ua_family)` is stored per scan.
   Pending earnings = `$0.25 x (distinct dedupe_hash per poster - 1)` computed by query.
   No live crediting ledger.
   Raw IPs are never stored.
3. Cash is separate from the in-app `credits` system.
   One new money table: `poster_payouts` (user, period, amount_cents, scan_count, status: `pending|held|paid|voided`).
4. Payouts are a job, not a product.
   `jobs/run_poster_payouts.py` computes earnings, applies fraud flags to holds, and emits a CSV for manual Interac e-Transfers.
   Admin marks rows paid.
5. Enrollment lives on the user: `payout_email` plus `promoter_tos_accepted_at` columns.
   No separate promoter entity.
   50 active posters per account, enforced at creation.

### Program rules (locked)

- $0.25 per unique scan per poster.
- The first (activation) scan pays $0.
- 50 active posters per account.
- Paid monthly on the 1st, any balance of $0.25 or more.
- No geo exclusivity (same board is fine).
- Flagged accounts get payouts held, not silently voided.
- Monthly program budget cap with a kill switch.

### Success criteria

Posters live at UW before frosh move-in weekend.
Scans attributed with dedupe working behind the deploy proxy.
Sep 1 payout run completes.
Support has one home.
Abuse can be paused without building fraud tooling.

### Dependency spine

1.1 to 1.2, then everything in categories 1-4.
Categories 5-9 are parallel from day one.
Category 10 gates on all.

## Category 1: Scan Attribution & Tracking (backend core)

### 1.1 Verify real client IP and audit `session_id` on the scan path

Confirm `GET /qr/{id}` sees the true client IP behind the deploy proxy (`X-Forwarded-For` handling in FastAPI/uvicorn config).
Document what `session_id` on `qr_code_scans` currently is (client-generated? cookie?).
Produce a short written finding: exactly which request fields are trustworthy inputs for the dedupe hash.
Done when: a note states the verified IP source and `session_id` semantics, with a curl test against staging proving the forwarded IP is captured.
Blocks 1.2.
Do first: every scan recorded without this is uncreditable.

### 1.2 Add `dedupe_hash` to scan recording

Migration adding `dedupe_hash` (text, indexed) to `qr_code_scans`.
In `record_scan`/`handle_scan`, compute `sha256(SERVER_SALT, client_ip, ua_family)` where `ua_family` is a coarse UA normalization (browser family plus OS, not the full string).
Salt comes from env.
Never store raw IP.
Done when: same device/IP yields identical hashes across requests, different devices differ, unit tests cover both, and no raw IP appears in any table or log line.
Depends: 1.1.

### 1.3 Add `program` marker to `qr_codes` plus activation-scan semantics

Migration adding `program` to `qr_codes` (promoter vs existing default).
Confirm the existing activation flow (`activate_poster_and_record_scan`) records the activation scan so it is identifiable (first scan per poster); earnings queries must exclude it.
Done when: promoter QRs are distinguishable and a test proves the first scan is excludable from earnings counts.
Depends: 1.2.

### 1.4 Earnings query plus `GET /qr/earnings` endpoint

New service function plus endpoint returning, for the authenticated user: per-poster `unique_scans` (distinct `dedupe_hash`), `creditable_scans` (uniques minus 1, floor 0), `pending_cents`, plus totals for the current open period.
Derived purely from `qr_code_scans`, no ledger.
Follows existing router/service/schema patterns.
Done when: correct values against seeded scan fixtures (duplicate hashes, activation exclusion, multi-poster), typed schema, added to generated API types.
Depends: 1.3.

### 1.5 Program config constants plus kill switch

Central constants in `core/constants` matching existing style: `RATE_PER_SCAN_CENTS=25`, `MAX_ACTIVE_POSTERS=50`, `MONTHLY_BUDGET_CAP_CENTS` (value from 8.3), and a `PROMOTER_PROGRAM_ENABLED` flag checked at QR creation.
Existing posters keep redirecting when off; new creation is blocked; UI shows a paused notice.
Done when: flipping the flag blocks new promoter QR creation with a clear error and the scan/redirect path is unaffected.
Depends: 1.3.
Parallel with 1.4.

## Category 2: Promoter Enrollment & Poster Management

### 2.1 Enrollment fields on user plus enroll endpoint

Migration adding `payout_email` and `promoter_tos_accepted_at` to users.
Endpoint (extend `routers/users.py` per existing pattern) to enroll: accepts payout email plus ToS acceptance, stamps timestamp.
Done when: enrolled state is queryable and re-acceptance overwrites with the latest timestamp.
Parallel with Category 1.
ToS text itself is 8.1; the endpoint can land first.

### 2.2 Open promoter QR creation to enrolled users plus 50-cap

In `qr.py`/`qr_code_service`, allow any enrolled user (not just org-managers/admins) to create QRs with `program=promoter`.
Enforce: user enrolled, program flag on (1.5), active promoter poster count under 50.
Support archiving a poster to free a slot, reusing the existing status/active field (do not add a new one).
Done when: the 51st create returns a clear 4xx, archive frees a slot, non-enrolled users are blocked, and org/admin QR flows are unchanged (regression tests).
Depends: 1.3, 1.5, 2.1.

### 2.3 Promoter QR destination

Promoter QRs redirect to the school events feed with attribution params (`utm_source=poster&poster_id=...`), using the existing redirect-config mechanism.
School is inferred from the creating user's school context.
Done when: a scan lands on the correct school feed with no signup wall and attribution params present.
Depends: 2.2.

## Category 3: Payouts & Money Ops (backend)

### 3.1 `poster_payouts` table plus service

Migration: `poster_payouts(id, user_id, period, amount_cents, scan_count, status pending|held|paid|voided, paid_at, notes, created_at)`, unique `(user_id, period)`.
New `services/payout_service.py` plus `routers/payouts.py` following repo conventions: user lists own payouts; admin lists/filters all and transitions status (`held->pending`, `pending->paid`, `held->voided`) with notes required on hold/void.
Done when: CRUD paths are tested, invalid transitions are rejected (no `paid->pending`), and a non-admin cannot see others' rows.
Depends: none for the table; 1.4 for amounts to mean anything.

### 3.2 Monthly payout job

`jobs/run_poster_payouts.py` (mirror `jobs/send_notifications.py` structure).
For a closed period: compute per-user creditable earnings from `qr_code_scans` (shared function with 1.4, not a copy), apply flag queries from 6.1 and write `poster_payouts` rows as `pending` or `held`, respect the budget cap (if exceeded: write rows but mark the run for manual review, never silently prorate), and emit CSV `(user_email, payout_email, amount_cents, scan_count, status)`.
Idempotent per period (re-run updates non-paid rows only).
Done when: dry-run mode works, re-run safety is tested, the CSV is correct against fixtures, and held users are excluded from the CSV.
Depends: 1.4, 3.1, 6.1.

### 3.3 Manual payout runbook (non-code)

One page: run job, review held rows (link the 6.2 checklist), send Interac e-Transfers from the business account using the CSV, mark rows paid in the admin UI, post a payout-complete announcement (7.1).
Include reconciliation (bank total = CSV total) and bounced-transfer handling.
Done when: committed to docs and the 10.3 rehearsal executes it without improvisation.
Depends: 3.2, 4.3.

## Category 4: Frontend

### 4.1 Enrollment UI in settings

Extend `features/settings`: a "Promoter program" section with explainer, payout email field, ToS checkbox (text from 8.1), and enroll CTA.
Enrolled state shows the payout email (editable) and a dashboard link.
i18n via the existing locale pattern.
Done when: the full enroll flow works against 2.1; unenrolled users see the pitch and enrolled users see status.
Depends: 2.1; 8.1 text can be stubbed.

### 4.2 Promoter poster dashboard

Extend `features/posters`: list my promoter posters with per-poster unique scans plus pending earnings (from 1.4), a totals header ("Pending this month: $X, Lifetime paid: $Y"), a create-poster flow (template picker from 5.1, renders poster PDF/PNG with the QR baked in), an archive action, an "X of 50 slots used" indicator, and a payout history table (from 3.1).
The empty state explains: your first scan activates the poster and pays $0, that is you testing it.
Done when: a pilot promoter does everything self-serve: create, download, see counts, see history.
Depends: 1.4, 2.2, 3.1, 5.1.

### 4.3 Admin payout review UI

Extend `features/admin`: payouts table filtered by period/status; row detail shows flag reasons (6.1 output); actions: release hold, void (reason required), mark paid (bulk, post-CSV run).
Done when: the Sep 1 run is fully executable from this screen plus the CSV, no DB console needed.
Depends: 3.1, 3.2.

## Category 5: Assets & Creative

### 5.1 Official poster template kit (UW v1)

3-5 letter-size templates: at least one B&W-print-optimized, one colour, one minimal/cheap-ink.
Evergreen copy (no dates): headline ("Every campus event. One feed."), QR zone, short value prop, wat2do.io.
Deliver as parameterizable assets the dashboard renders with a per-poster QR (coordinate format with the 4.2 owner).
Done when: printed samples scan reliably from 1.5m or more on a phone, with the QR error-correction level chosen accordingly.
Start immediately.
Candidate design ask for Brayden (see the Waterloo Commons Revival project).

### 5.2 Custom creative rules (policy doc)

One-pager: must use the assigned QR unmodified; no third-party brands; no misleading claims; must comply with campus posting policy; Wat2Do may request a photo of any posted poster; violations deactivate the poster and repeats remove the account.
Post-hoc spot checks, no pre-approval queue.
Done when: linked from onboarding (7.2) and ToS (8.1).

### 5.3 School-branded template variants (multi-school, later tier)

Parameterize 5.1 by school (name, colours) so a new campus needs config, not design work.
Done when: a second school's kit is produced in under 1 hour from config.
Depends: 5.1.

## Category 6: Trust & Abuse Ops

### 6.1 Fraud flag queries

Functions callable by the payout job and ad-hoc:
(a) burst velocity (N unique hashes on one poster within M minutes);
(b) datacenter/VPN ASN share above threshold (pick a free IP-to-ASN dataset and document the choice);
(c) same dedupe_hash crediting more than K posters of one account;
(d) IP-geo country mismatch for the poster's school;
(e) earnings outliers (top 5% $ per poster flagged for eyeball review).
Thresholds live as constants with rationale.
Output: per-user flag list with reasons.
Note: (b) and (d) need ASN plus country code stored per scan at record time (still no raw IP); decide and document.
Done when: fixture-based tests exist per signal and the job integration writes reasons onto held payout rows.
Depends: 1.2.

### 6.2 Hold-review checklist plus enforcement ladder (policy doc)

Per flag type: what to check, what evidence to request (photos of posters up), response templates, resolution paths (release / void / ban), and the escalation ladder (first offense voids the month, second bans).
Target: any held account resolved in under 15 minutes of admin time.
Done when: the doc exists and is used in the 10.3 rehearsal on a synthetic flagged account.
Depends: 6.1.

## Category 7: Comms, Support & Onboarding

### 7.1 Discord server setup

Wat2Do Promoters Discord: `#announcements` (locked), `#ask-questions`, `#uwaterloo`, `#wins` (screenshot flex channel, retention fuel).
Basic moderation, stable invite link.
`support@wat2do.io` is reserved for payout disputes only, with an auto-reply pointing to Discord.
Done when: the server is live and the invite is linked from the dashboard (4.2) and the onboarding doc.
Start immediately.

### 7.2 Promoter onboarding one-pager

Covers: how money works (rate, activation scan pays $0, monthly payout, $0.25 minimum), the 50-cap, where and how to post legally at UW (from 9.1), print guidance (a B&W poster pays for itself after 1 scan), creative rules (5.2), payout schedule, and Discord and ToS links.
Include a pre-answer for "why isn't my scan count going up" with dedupe explained in plain words; this will be 80% of support volume.
Done when: a stranger goes from zero to poster-on-wall using only this doc; linked from the enrollment UI.
Depends: 5.2, 8.1, 9.1.

### 7.3 Recruiting funnel

An "Earn money postering" entry point: app footer/nav link to enrollment; outreach templates for UW club execs (clubs already on Wat2Do first, they have double incentive); a frosh-group-chat blurb; simple tracking of who was contacted.
Done when: 10 or more pilot promoters are recruited for Jul 28 (gate for 10.2) and the templates are reusable per school.
Depends: 4.1 live (or a waitlist form as a stopgap).

## Category 8: Legal & Policy

### 8.1 Promoter Terms of Service

One page: rewards program not employment; payouts discretionary pending fraud review; fraud voids balance and terminates the account; promoter responsible for campus posting compliance; program may be paused or ended anytime; rate and cap changeable prospectively with notice; privacy note (hashed scan data, no raw IP or geolocation stored).
Checkbox target for 2.1/4.1.
Done when: text is finalized and versioned, rendered at enrollment.
Start immediately: this blocks any real-money pilot.

### 8.2 Privacy review of scan data

Written check that the scan pipeline matches 8.1 and the app's privacy policy: salted hash non-reversible in practice, salt storage policy (must not rotate mid-period, since rotation resets uniqueness), ASN/country storage covered, retention period for scan rows stated.
Done when: a findings doc exists and gaps are filed as issues.
Depends: 1.2, 6.1 decision.

### 8.3 Monthly budget cap decision (founder)

Set `MONTHLY_BUDGET_CAP_CENTS` and the over-cap behavior.
Recommendation: $3,000/mo for fall; on approach, pause new QR issuance, never already-earned payouts.
Done when: the number is committed into the 1.5 constants with rationale.

## Category 9: Campus Ops & Multi-School Playbook

### 9.1 UW posting-rules one-pager (ops research)

Where posting is allowed at UW (SLC/Turnkey stamp process, WUSA boards, plaza kiosks, res boards), the approval process, turnaround, and what gets torn down.
Half a page, link-heavy, verified against current policy (not memory).
Done when: the verified doc feeds 7.2.
Start immediately.

### 9.2 New-school launch checklist (playbook doc)

The repeatable per-campus column:
(1) event feed seeded (hard gate, never enable promoters on an empty feed);
(2) posting-rules one-pager;
(3) campus lead recruited;
(4) branded template variant (5.3);
(5) Discord channel;
(6) program flag enabled for that school.
Include a per-item owner and time estimate.
Done when: executable by a campus lead with under 2 hours of central support.
Depends: learnings from 10.2; finalize Aug 11-24.

### 9.3 Campus lead role definition (later tier)

Responsibilities (posting-rules doc, local recruiting, first-line Discord answers), compensation (fixed monthly stipend via the same payout rail, not equity or employment, preserving the 8.1 posture), and selection criteria (top promoter, responsive).
Done when: a one-pager plus an offer-message template exist.
Depends: 8.1.

## Category 10: Launch Execution (sequential gates)

### 10.1 Pilot readiness gate (target Jul 28)

Verify end-to-end on staging/prod: enroll, create poster, print, physically scan (activation), second device scans, dashboard count increments, earnings correct.
Explicitly verify the dedupe hash differs across devices on campus eduroam and on cellular; this is the field test of the NAT/CGNAT design.
Done when: the written checklist is all green and the eduroam finding is documented.
Depends: 1.x, 2.x, 4.1, 4.2, 5.1, 7.1, 8.1.

### 10.2 Closed pilot (Jul 28 to Aug 10)

5-10 hand-picked UW promoters (club execs first).
Weekly Discord check-in; track scan counts vs promoter-reported reality (dedupe sanity), scan-to-signup conversion, poster survival time, and support questions (fed back into 7.2).
Done when: a pilot report exists with the dedupe verdict, a CAC estimate, and the top 3 fixes filed.
Depends: 10.1, 7.3.

### 10.3 Payout rehearsal (by Aug 20)

Run 3.2 for the pilot period with real (tiny) balances, execute the 3.3 runbook end-to-end including one synthetic flagged account through the 6.2 checklist, send real e-transfers, and mark paid in 4.3.
Done when: real money is delivered, runbook gaps are fixed, and admin time is measured.
Depends: 3.2, 3.3, 4.3, 6.2, 10.2.

### 10.4 Open launch plus frosh blitz (Aug 25 to Sep 3)

Open UW enrollment; announce via clubs and frosh channels; posters up before move-in weekend; monitor the budget cap and flag queries every 2-3 days.
Sep 1: first public payout run plus an announcement in `#announcements` ("we paid N promoters $X on time"), which is the program's strongest recruiting asset.
Done when: posters are live before move-in, the Sep 1 run happens on schedule, and the recruiting post is published.
Depends: everything above.

## Parallelization map

- Fully parallel from day one: 1.1, 2.1, 3.1, 5.1, 5.2, 7.1, 8.1, 8.3, 9.1.
- Wave 2 (after 1.2/1.3): 1.4, 1.5, 2.2 then 2.3, 6.1.
- Wave 3: 3.2, 4.1-4.3, 6.2, 7.2, 8.2.
- Gates: 10.1 to 10.2 to 10.3 to 10.4; 9.2/9.3/5.3 ride alongside during August.
- Single hard blocker for all real-money activity: 8.1 (ToS) plus 1.1/1.2 (attribution integrity).
