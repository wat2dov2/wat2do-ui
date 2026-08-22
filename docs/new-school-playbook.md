# New School Playbook

Use this playbook to launch one new Wat2Do school from a school name supplied by a human.

The executor may be an AI agent, but the executor must still follow `AGENTS.md`, inspect the current codebase before editing, protect credentials, use dry runs before writes, and collect evidence for every completion gate.

Do not declare a school launched because a row, logo, or Instagram account merely exists.

A launch is complete only when the school identity, database records, organization directory, Instagram account, following and notification setup, publishing credentials, Automate routing, application behavior, and verification gates all pass.

## 1. Definition of done

A new school is complete only when all of the following are true:

- The canonical school slug, official name, student email domains, timezone, current academic-term dates, academic-calendar source, official Instagram handle, student association, official organization directory, and official event directory have been researched from authoritative sources.
- The school and every accepted student email domain exist in Supabase through the normal migration path.
- The school has validated primary and secondary brand colors in Supabase and in `assets/school-logos/colors.json`.
- `assets/school-logos/<schoolslug>.jpg` exists, matches the established dimensions and visual contract, and has been inspected at Instagram-avatar size.
- Every organization listed by the selected authoritative directory has been accounted for, deduplicated, and imported into `public.organizations` with every supported field that can be verified.
- Every organization imported from the official student-association directory has the school's verified association `organization_type`; organizations added from outside that directory use `independent` unless a separate association source proves otherwise.
- Missing Instagram handles have received the required parallel search and independent validation passes.
- The chapter Instagram account exists as `<schoolslug>.wat2do.io`, is not joined to a shared Accounts Center, is a professional Business account, and has the standard Wat2Do profile.
- The chapter account follows every verified organization Instagram account stored for that school.
- Instagram post notifications are set to `All` for every followed organization when Instagram exposes the consolidated notification screen.
- The chapter account is logged into the dedicated Android device that runs the Automate flow.
- A real notification from the chapter account has been observed, its Automate recipient identifier is mapped to the school, and the `process-single-user` workflow resolves it to the correct school.
- The chapter account is configured in the Meta developer app using Instagram API with Instagram Login.
- The account's validated Instagram-scoped user ID and encrypted access token exist in `public.instagram_publishing_accounts`.
- A publishing draft can be generated for the school and the production token-maintenance path recognizes the account.
- Frontend checks, backend tests, migration reset, database audits, and the allowed non-browser verification steps pass.
- Every credential, token, session cookie, and temporary secret file has been removed from logs, screenshots, shell history, task notes, and tracked files.

## 2. Source-of-truth map

Do not introduce a second source of truth.

| Concern | Authoritative source | Notes |
| --- | --- | --- |
| School identity and public slug | `public.schools` | The frontend resolves school hosts dynamically and does not need a hardcoded school list entry. |
| Student email domains | `public.school_email_domains` | One domain is primary and every accepted alias is a separate row. |
| School colors | `public.schools.primary_color` and `public.schools.secondary_color` | Primary is the logo background and secondary is the Wat2Do mark. |
| Logo research manifest | `assets/school-logos/colors.json` | Store source URL, confidence, official names, color names, file name, and the semantic color contract. |
| Instagram profile image | `assets/school-logos/<schoolslug>.jpg` | Current assets are 1024 by 907 JPEG files. |
| Organizations and their supported social fields | `public.organizations` | Use the school foreign key and fill only verified fields. |
| Organization association type | `public.organizations.organization_type` | Store the verified student-association slug or `independent`; events derive it through their organization relation. |
| Organization-type presentation | `frontend/src/shared/data/organizationTypeAssets.ts` and `frontend/public/icons/organization-types/` | A `<schoolslug>:<organization_type>` signature selects the association SVG. |
| Expected Instagram publishing accounts | `backend/controlbox/instagram_publishing.json` | This contains non-secret account keys, school slugs, usernames, and enablement only. |
| Instagram publishing identity and credentials | `public.instagram_publishing_accounts` | This service-role-only table stores the validated user ID, username, encrypted token, expiry, and reauthorization state. |
| Instagram token encryption key | Ignored backend environment file and production secret manager | Never store it in a controlbox file, migration, document, or task output. |
| Notification-to-school routing | `public.schools.recipient_id` | This is the identifier observed from the Android Automate notification payload. |
| Single-account scrape school resolution | `backend/services/scraper/single_user.py` | It resolves `INTENDED_RECIPIENT_ID` through Supabase and already accepts database-added schools. |
| Organization following targets | Supabase organizations for the school | Follow the verified target set through the logged-in Android account while browser-cookie automation is paused. |
| Bell notification state | Instagram Android application state | `automate_bell_notifications.py` drives the already-open consolidated list and does not read the spreadsheet. |

## 3. Important distinctions and corrections

### 3.1 Never store publishing tokens on `public.schools`

Do not add `instagram_user_id` or `access_token` columns to `public.schools`.

The repo already has the correct one-to-one credential relation in `public.instagram_publishing_accounts`.

That table references `schools.id`, is protected by row-level security, stores the access token encrypted with Fernet, tracks expiry and reauthorization state, and is consumed by the publishing service.

Putting a plaintext or encrypted token directly on `public.schools` would duplicate the established credential owner and weaken separation between public school metadata and secrets.

### 3.2 Keep the two Instagram identifiers separate

`public.schools.recipient_id` and `public.instagram_publishing_accounts.instagram_user_id` are not interchangeable.

The recipient ID comes from the Android notification and routes an Automate-triggered scrape to a school.

The publishing user ID is returned by the Instagram API `/me` identity request for the generated token and is used by the publishing API.

Record each identifier only after observing it through its own workflow.

### 3.3 Use Instagram Login, not the Facebook Page route

The current Wat2Do publishing path uses Instagram API with Instagram Login.

It uses `graph.instagram.com`, an Instagram user access token, and the `instagram_business_basic` and `instagram_business_content_publish` permissions.

It does not require a connected Facebook Page.

Do not use the old Facebook Login flow, Meta Business Suite Page asset assignment, a shared Page access token, or `me/accounts?fields=...instagram_business_account` for a new chapter.

Meta documents the distinction in its official [Instagram API with Instagram Login collection](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login) and [Instagram API documentation](https://www.postman.com/meta/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00).

### 3.4 `scrape.py` does not need publishing credentials

Do not modify `backend/jobs/scrape.py` merely because a new publishing token was added.

The single-user scraper consumes an Instagram post or username and resolves its school from `INTENDED_RECIPIENT_ID` or `TARGET_SCHOOL` through `school_service`.

It does not use the Meta publishing token or publishing user ID.

### 3.5 Browser-cookie follow automation is paused

Do not extract an Instagram browser cookie or create a replacement browser-session follow script.

Until an approved database-backed Android automation path exists, follow the verified Supabase target set through the logged-in Instagram Android application.

`backend/scripts/automate_bell_notifications.py` does not read the spreadsheet.

It only drives the consolidated Instagram notification list that a human or agent has already opened.

Do not rewrite it to query Supabase unless completeness reconciliation against an expected database handle set is an explicitly approved requirement.

## 4. Security and account isolation rules

These rules are hard gates.

1. Never commit or paste an Instagram password, access token, session cookie, CSRF token, encryption key, recovery code, or two-factor secret.
2. Never document a deterministic password recipe in a tracked file.
3. Receive account credentials from the approved secret manager or directly from the human through a secure out-of-band channel.
4. Use a unique password for every chapter account and store it in the approved password manager.
5. Use the approved operations registration email supplied by the human.
6. The current operational registration email is `tobyniu18@gmail.com`, but confirm with the human that it is still approved before creating an account.
7. Do not add a new chapter account to a shared Meta Accounts Center.
8. Do not enable Facebook login, contact syncing, cross-profile login, or automatic profile linking during registration.
9. A local Instagram app may retain multiple independent account sessions, but that is not permission to join those accounts in Accounts Center.
10. Treat every Instagram account limit, security challenge, suspension, or identity check as a real blocker that must be recorded.
11. Do not bypass Instagram or Meta security controls.
12. Do not extract, store, or automate with Instagram browser-session cookies.
13. Any token that has appeared in chat, Linear, shell output, a screenshot, or a tracked file must be revoked and regenerated before use.

The legacy WAT-154 Linear issue contains a plaintext token.

Treat that token as compromised, never reuse it, and have an authorized Meta administrator revoke or rotate it.

## 5. Phase A: Research the school identity

### 5.1 Required intake

The human supplies one school name.

The executor must derive and verify the rest.

Create a working evidence table with these fields before editing code or data:

| Field | Required evidence |
| --- | --- |
| Canonical official name | Official university website |
| Canonical slug | Student email evidence plus public-host and Instagram naming review |
| Primary student email domain | Official university IT or account documentation |
| Additional accepted student domains | Official documentation for aliases, legacy domains, or campus subdomains |
| IANA timezone | Official campus location plus IANA timezone identifier |
| Official university website | Official domain |
| Official university Instagram handle | Link from the official website or a clearly verified account |
| Primary and secondary colors | Official brand standards or visual identity guide |
| Academic calendar URL | Official registrar or academic calendar |
| Current semester start and end | Official academic dates for the launch term |
| Main student association | Official university or association source |
| Organization type slug | Existing lower-case slug convention for the association |
| Official organization directory | The most complete authoritative directory available |
| Official event directory | The student association or university event listing used for launch seeding or ongoing discovery |
| Directory platform | Static HTML, CampusGroups, CampusLabs, Rubric, WordPress, custom SPA, API, or another observed platform |
| Directory organization count | Count produced after complete pagination and deduplication |

### 5.2 Choose the canonical slug

Find the primary email domain used by currently enrolled students before choosing a slug.

Do not assume the university's apex domain is a student domain.

Some schools use a student-only subdomain or a separate mail domain, while staff use the apex domain.

Start from the recognizable institutional identifier in the primary student email domain.

Ignore generic mail labels such as `mail`, `live`, `student`, and `courrier` when identifying the institution.

Do not mechanically use the first DNS label when it produces an awkward or ambiguous public slug.

The final slug must be the short, recognizable identifier that will be used consistently by all of the following:

- `public.schools.slug`
- `https://<schoolslug>.wat2do.io`
- `<schoolslug>.wat2do.io` on Instagram
- organization school relationships
- Instagram publishing account key and school value
- follow automation selection
- task evidence and operational handoff

The slug must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`.

Check for collisions with existing schools, campuses that share one email domain, trademark ambiguity, and existing Wat2Do hosts before accepting it.

For multi-campus systems, use the campus identity rather than collapsing distinct campuses into one domain-derived slug.

Record the chosen slug, rejected candidates, and the reason for the choice.

### 5.3 Research primary and secondary colors

Use an official university brand guide whenever one exists.

Record the exact six-digit hexadecimal value, official color name, source URL, and confidence level.

Wat2Do's semantic logo contract is fixed:

- `primary_color` is the full logo background.
- `secondary_color` is the Wat2Do mark or foreground artwork.

Choose an official contrasting brand color for the mark.

White may be the secondary color when it is part of the official palette and provides the clearest contrast.

Do not swap the two roles merely because an official university logo uses a white field.

### 5.4 Research academic and routing metadata

Use an official registrar or academic calendar source for the launch term.

Record `semester_start`, `semester_end`, and `url_with_semester_dates`.

Use the campus's IANA timezone, such as `America/Toronto`, instead of an abbreviation such as `EST`.

Leave `recipient_id` null until it has been observed from the Automate notification flow.

Never guess a recipient ID from the Meta API user ID.

## 6. Phase B: Plan the code and database change

Before editing, follow the mandatory pre-edit report in `AGENTS.md`.

At minimum, inspect the following current sources because their structure may have changed since this playbook was written:

- The newest migrations that insert or update `public.schools` and `public.school_email_domains`.
- `backend/schemas/school.py`.
- `backend/services/school_service.py`.
- `backend/core/allowed_emails.py`.
- `backend/supabase/seed.sql`.
- `assets/school-logos/colors.json`.
- `backend/controlbox/instagram_publishing.json`.
- `backend/core/controlbox.py` and its tests.
- `backend/scripts/import_instagram_tokens.py`.
- `backend/services/instagram_publishing/credentials.py`.
- `backend/scripts/automate_bell_notifications.py`.
- `backend/services/scraper/single_user.py`.
- `.github/workflows/process-single-user.yml`.
- The current organization import, deduplication, and enrichment scripts.

Search the repo for the proposed slug before adding it.

Do not add a frontend school constant when the frontend already reads the school directory from the backend.

Do not add an alias, fallback mapping, or second credential configuration path.

## 7. Phase C: Add the school through Supabase migrations

Create one normal, reviewable migration for the new school and its related authoritative data.

The migration must insert the school with all non-null fields required by the current schema:

- `slug`
- `name`
- `timezone`
- `primary_color`
- `secondary_color`
- `semester_start`
- `semester_end`
- `url_with_semester_dates`

Set `recipient_id` only if it has already been observed and verified.

Insert the primary student email domain into `public.school_email_domains` with `is_primary = true`.

Insert every verified accepted secondary or legacy student domain with `is_primary = false`.

Do not add a domain used only by faculty, staff, alumni, applicants, or the public.

Use `schools.id` relationships and the migration style used by the latest school migrations.

Audit `backend/supabase/seed.sql` as required by `AGENTS.md`.

Update the seed only when the new migration or schema change creates a seeded-data dependency.

Do not duplicate the school row in the seed merely because the migration adds it.

### 7.1 Database verification

Verify all of the following after applying the migration:

```sql
select
  id,
  slug,
  name,
  timezone,
  recipient_id,
  primary_color,
  secondary_color,
  semester_start,
  semester_end,
  url_with_semester_dates
from public.schools
where slug = '<schoolslug>';
```

```sql
select domain, is_primary
from public.school_email_domains
where school_id = (
  select id from public.schools where slug = '<schoolslug>'
)
order by is_primary desc, domain;
```

Confirm that exactly one intended domain is primary.

Confirm that the school search endpoint finds the school by slug, name, and email domain.

Confirm that an allowed student email resolves to the new slug and that a staff-only domain does not.

## 8. Phase D: Create the school logo

### 8.1 Update the color manifest

Add one entry to `assets/school-logos/colors.json` using the canonical school slug.

The entry must include:

- `slug`
- `official_name`
- `confidence`
- `source_url`
- `file`
- `primary_hex`
- `primary_name`
- `secondary_hex`
- `secondary_name`
- `notes`

Set `file` to `<schoolslug>.jpg`.

State in `notes` that primary is the background and secondary is the Wat2Do mark.

### 8.2 Generate the JPG

Inspect at least three existing school JPGs and the shared Wat2Do mark before generating the new file.

Reuse the established composition instead of inventing a new logo system.

The current school-logo assets are 1024 by 907 JPEG files.

Create `assets/school-logos/<schoolslug>.jpg` with the full primary color as the background and the secondary color as the Wat2Do mark.

Keep the mark position, scale, margins, antialiasing, and JPEG treatment consistent with neighboring assets.

Do not place the university's trademarked crest or wordmark into the image unless the human has explicitly approved that use.

### 8.3 Verify the JPG

Verify the following:

- The file is a valid JPEG.
- The dimensions match the established school-logo assets.
- The background samples to the selected primary color outside antialiased edges.
- The mark uses the selected secondary color.
- The mark remains legible in Instagram's circular crop.
- The file name matches the canonical slug.
- The database colors exactly match the manifest colors.
- The image remains recognizable at approximately 110 pixels wide.

## 9. Phase E: Discover the authoritative organization directory

### 9.1 Select the source

Search for the official directory run by the main student association, student affairs office, or university.

Prefer the source that provides the most complete and current list of recognized student organizations.

Verify that the source is authoritative by linking it back to the university or student association.

Do not treat a search-engine result, Instagram following list, third-party blog, or stale PDF as the primary inventory when a maintained official directory exists.

Record the directory home URL, platform, pagination method, estimated organization count, last-updated signal, and any campus or faculty filters.

Separately identify the official event directory used to seed or supplement the event feed.

Do not confuse an organization directory with the event-directory scraper configured in `backend/services/scraper/urls/directories.json`.

### 9.2 Inspect the site before choosing a scraper

Determine whether the directory exposes data through:

- Static paginated HTML.
- Organization detail pages.
- Embedded JSON.
- A public API used by the site's frontend.
- A custom SPA.
- CampusGroups or CampusLabs.
- Rubric.
- WordPress or another CMS.
- Search or category filters that hide entries until selected.

Inspect the existing directory and SPA scraper implementations before adding or extending code.

Reuse an existing platform adapter when the new directory uses the same platform.

If none fits, report the patterns checked and propose the smallest new platform adapter before implementing it.

Never add a one-school copy of an existing scraper.

### 9.3 Database-first requirement

The desired end state is Supabase-first organization onboarding.

The current discovery pipeline still passes through `backend/services/scraper/wat2do-clubs.xlsx` in several scripts.

Before launching a new school, consolidate this path so that the database is the authoritative inventory and the workbook is, at most, a generated export.

The affected legacy scripts currently include:

- `backend/scripts/spa_scrape.py`
- `backend/scripts/merge_spa_output.py`
- `backend/scripts/search_missing_instagrams.py`
- `backend/scripts/ig_search_shards.py`
- `backend/scripts/import_master_clubs_xlsx.py`

Do not create parallel database and spreadsheet import implementations.

Replace the old authoritative path in one change, delete or convert obsolete write paths, update tests, and leave one obvious workflow.

### 9.4 Supported organization fields

The current `public.organizations` contract supports these onboarding fields:

- `organization_name`
- `categories`
- `organization_page`
- `ig`
- `discord`
- `organization_type`
- `logo_url`
- `school_id`
- `status`

Fill every supported field that can be verified from the directory or an official organization source.

Use only canonical categories from `backend/core/constants/organizations.py`.

Normalize Instagram values to the repo's established handle form.

Normalize Discord values to a valid invite URL.

Use the official organization detail page as `organization_page`.

Use an official logo asset URL only when it is clearly attached to that organization.

Set imported, reviewed directory organizations to the status expected by the existing administrative import path.

Assign the school's verified association organization-type slug to every organization imported from the official student-association directory.

Use `independent` only for organizations added from outside that directory unless another association source is explicitly approved.

The current organization table does not have dedicated Facebook, campus, source-evidence, or research-confidence columns.

Capture Facebook and campus data from the official directory in the staged research artifact, but do not stuff it into another database field.

If those fields must become product data, propose and approve one schema path before import.

### 9.5 First-pass directory extraction

The first pass must visit every directory page and every organization detail page needed to capture available metadata.

Extract all of the following when present:

- Organization name.
- Category or categories.
- Campus or faculty.
- Organization detail URL.
- Instagram URL or handle.
- Discord invite URL.
- Facebook URL.
- Official website.
- Logo URL.
- Association affiliation evidence.

Always attempt Instagram, Discord, and Facebook extraction from the official directory and organization detail pages.

The later broad search batch may skip Discord and Facebook, but the authoritative directory pass must not skip them.

Paginate until no new organization identifiers appear.

Apply every necessary directory filter and verify that the count is stable across a second collection pass.

Deduplicate by stable directory identifier or canonical detail URL first, then by normalized school and organization name.

Do not deduplicate two distinct campus chapters merely because their display names are similar.

### 9.6 Classify every organization's type

`organization_type` is not an event category, organization topic, legal structure, campus, faculty, or synonym for `club`.

In this repo, it identifies the school-level student association that officially recognizes or affiliates an organization.

Do not use legacy or generic values such as `other`, `social`, `association`, `student-club`, or `official`.

#### Determine the school's association type

Research the main student association from official university or association sources.

Record its official name, acronym, official website, directory URL, and the source that explains its relationship to listed organizations.

Choose the organization-type slug from the official acronym when possible.

The slug must be lowercase, trimmed, between 1 and 100 characters, and match `^[a-z0-9]+(?:-[a-z0-9]+)*$`.

Examples already used by the repo include `wusa`, `ams`, `ssmu`, `sfss`, `cusa`, `uosu`, and `independent`.

Search `frontend/src/shared/data/organizationTypeAssets.ts` before creating the value.

If a signature for the new school already exists, use that exact organization type.

If the school does not yet have a signature, add exactly one reviewed signature for the verified association.

#### Apply one type to the directory import

The selected organization source for this playbook is the official student-association directory.

Treat inclusion in that directory as verification that the organization belongs to that student-association type.

Assign the same verified association slug to every organization imported from the directory.

Do not perform separate row-by-row affiliation research for those directory organizations.

Every staged directory record must contain:

```json
{
  "organization_type": "<association-slug>",
  "organization_type_source": "https://official-student-association-directory.example/"
}
```

The source URL may remain in the staged research artifact when the database has no provenance column.

The database-backed importer must explicitly include `organization_type` in inserts and reviewed updates.

Do not rely on the database default because that would silently turn directory organizations into `independent`.

The current `backend/scripts/import_master_clubs_xlsx.py` intentionally does not update `organization_type`.

That is another reason it cannot be the authoritative new-school importer for this workflow.

Organizations added later from outside the official student-association directory use `independent` unless the human approves another authoritative association source.

Instagram-enrichment subagents must preserve the association type already assigned by the directory import.

#### Register the association presentation

For a new non-independent organization type, inspect the existing organization-type SVG assets and registration pattern.

Add one association SVG under `frontend/public/icons/organization-types/` using the established school-and-association filename convention.

Add the `<schoolslug>:<organization_type>` signature to `frontend/src/shared/data/organizationTypeAssets.ts` and point it to that single SVG.

Use the official association mark or wordmark only when its use is approved and the source can be documented.

Match the existing monochrome SVG-mask contract so `OrganizationTypeIcon` can fill it with `currentColor`.

Do not add an icon for `independent`.

Do not place asset paths in the database or API response.

Verify that organization cards, organization details, event cards, event details, admin filters, and organization forms all resolve the new signature through the shared registry.

Events must continue deriving `organization_type` from their owning organization.

Do not add or restore an `events.organization_type` column.

## 10. Phase F: Enrich missing Instagram handles with subagents

### 10.1 Build the missing set

After the directory pass is stored, query the database for organizations at the new school whose `ig` field is null or fails normalization.

Exclude rows already carrying a verified profile from the official directory.

Exclude the university-wide Instagram account, the student association's global account when it is not the organization itself, and known directory-chrome accounts.

Export a deterministic research input containing the organization database ID, school slug, organization name, organization page, category, and any directory evidence.

### 10.2 Run at least 15 independent browser-search jobs

Run at least 15 bounded subagent jobs across the remaining missing-Instagram set.

If the environment cannot run 15 at once, run sequential waves until at least 15 independent jobs have completed.

Shard the rows so no two primary jobs own the same organization.

Keep shards small enough that every result receives evidence rather than a guessed handle.

If fewer than 15 organizations are missing, assign one primary search per missing organization and use the remaining jobs as independent verification passes over the proposed matches and unresolved rows.

Subagents must use browser or web search and must not write directly to Supabase, the workbook, or tracked files.

Each subagent returns structured results to one coordinator.

### 10.3 Required subagent search procedure

For each assigned organization, the subagent must:

1. Open the official directory page and any official organization website first.
2. Search for the exact organization name plus the school name and `Instagram`.
3. Search `site:instagram.com` with the exact organization name and at least one school alias.
4. Search common acronym and school-abbreviation variants only when supported by the organization name.
5. Open candidate Instagram profiles or reliable indexed profile metadata.
6. Confirm both organization identity and school context.
7. Reject accounts for another campus, a similarly named external organization, the university as a whole, a person, an event, or a stale renamed club without corroboration.
8. Return no match when evidence is insufficient.

Broad subagent search does not need to hunt for Discord or Facebook as a separate objective.

However, if the official directory page or official organization website exposes Discord or Facebook during the Instagram search, the subagent must return those URLs as additional evidence.

### 10.4 Required result shape

Each result must contain:

```json
{
  "organization_id": 123,
  "school": "<schoolslug>",
  "organization_name": "Example Organization",
  "instagram_handle": "@example",
  "instagram_url": "https://www.instagram.com/example/",
  "confidence": "high",
  "evidence_urls": [
    "https://official-directory.example/organization/example",
    "https://www.instagram.com/example/"
  ],
  "school_context_evidence": "Profile or official site identifies the school",
  "discord_url": null,
  "facebook_url": null,
  "notes": ""
}
```

Use `null` for an unresolved handle.

Do not omit an unresolved row from the results.

### 10.5 Coordinator validation and merge

One coordinator must validate and apply all results after every subagent finishes.

The coordinator must:

- Reject malformed Instagram URLs and reserved path names such as `p`, `reel`, `explore`, `accounts`, and `stories`.
- Reject known global school handles when the row represents a student organization.
- Check that one handle is not assigned to multiple unrelated organizations.
- Require school context plus organization-name evidence.
- Preserve stronger directory-provided evidence over weaker search results.
- Send medium-confidence matches to an independent verification pass.
- Leave low-confidence matches null.
- Produce counts for total organizations, official-directory Instagram matches, newly confirmed search matches, unresolved Instagram rows, Discord links, Facebook links, duplicate candidates, and rejected candidates.

Apply validated changes through one idempotent database import path.

Never allow subagents to race by editing the same database rows or artifact.

## 11. Phase G: Audit and import organizations

Run the database import in dry-run mode first.

The dry run must report inserts, updates, unchanged rows, duplicates, invalid categories, invalid URLs, invalid organization types, unknown school references, and unresolved required fields.

Review sample diffs from every category of change before applying.

The import must be idempotent.

Key organization identity by the established database relation and normalized organization identity, not by spreadsheet row number.

After applying, query the new school and verify:

```sql
select
  count(*) as organizations,
  count(*) filter (where ig is not null) as with_instagram,
  count(*) filter (where discord is not null) as with_discord,
  count(*) filter (where organization_page is not null) as with_directory_page,
  count(*) filter (where logo_url is not null) as with_logo,
  count(*) filter (
    where organization_type = '<association-slug>'
  ) as association_directory_organizations
from public.organizations
where school_id = (
  select id from public.schools where slug = '<schoolslug>'
);
```

Also audit duplicate Instagram handles within the school and across all schools.

Audit organizations without names, invalid URLs, empty category arrays, unrecognized categories, and unexpected statuses.

Audit the exact organization-type distribution:

```sql
select organization_type, count(*)
from public.organizations
where school_id = (
  select id from public.schools where slug = '<schoolslug>'
)
group by organization_type
order by organization_type;
```

Confirm the association-type count equals the number of organizations imported from the official directory.

Confirm that no directory organization is null, `independent`, mixed-case, whitespace-padded, generic, or assigned another type.

Confirm that every non-independent `<schoolslug>:<organization_type>` signature resolves to the expected shared frontend asset.

Compare the final database count to the authoritative directory count and account for every difference in a reconciliation report.

## 12. Phase H: Create the chapter Instagram account on Android

### 12.1 Prepare the emulator or device

Use Android Studio Device Manager or the explicitly approved Android device.

The repo policy prohibits an agent from launching a browser, emulator, or long-running process without an explicit in-the-moment request from the human.

Confirm the target device with:

```sh
~/Library/Android/sdk/platform-tools/adb devices
```

Select one explicit serial such as `emulator-5554` for every ADB command.

Do not assume the first connected device is the intended device.

### 12.2 Create the account

Create the account in the Instagram Android application.

Use `<schoolslug>.wat2do.io` as the username.

Retrieve the unique account password from the approved password manager or the human.

Use the approved operations registration email after confirming it is still accessible.

Complete email verification and any legitimate security challenge.

Decline contact syncing, Facebook connection, suggested cross-profile login, and shared Accounts Center enrollment.

If Instagram attempts to place the account into an existing Accounts Center, choose the separate-account option.

Reopen Accounts Center after creation and verify the new chapter was not added to a shared center.

Record account creation success without recording the password or verification code.

### 12.3 Convert to a professional Business account

Open **Settings and activity**, then **Account type and tools**.

Switch to a professional account.

Choose the closest available community category.

Prefer **Community Organization** when Instagram does not offer an exact **Community** category.

Choose **Business** as the professional account type.

Skip advertising and Facebook Page connection.

Confirm that **Professional dashboard** appears.

Professional accounts must remain public for this workflow.

## 13. Phase I: Apply the standard Instagram profile

### 13.1 Set the profile image

Push the school logo to the selected device:

```sh
adb -s <device-serial> push \
  assets/school-logos/<schoolslug>.jpg \
  /sdcard/Download/<schoolslug>.jpg
```

Trigger a media scan if the file does not appear in the picker.

Open **Edit profile**, choose **Edit picture or avatar**, then choose **Choose from library**.

Grant only the photo permission needed to select the pushed logo.

Select the JPG and verify the circular crop before saving.

### 13.2 Set the display name and bio

Treat profile editing as a rate-sensitive manual workflow.

Enter the display name, bio, link title, and other editable profile text one character at a time at a deliberate human pace, using variable pauses of 180 to 320 milliseconds between characters and pauses of 1 to 3 seconds between fields.

Do not paste a complete field, use an instantaneous set-text operation, or inject a full bio through ADB or another automation interface.

Stop if Instagram displays a rate-limit warning, security challenge, unusual-login prompt, or other anti-abuse signal.

Set the display name to:

```text
Wat2Do | Sharing Events @ <schoolslug>
```

Set the bio to exactly three lines:

```text
Connecting events on campus to you
Official Wat2Do chapter @<official_school_instagram_handle>
Checkout all events below 👇
```

Use the verified official university Instagram handle.

Confirm the mention is linked and opens the intended official account.

### 13.3 Set category, link, contact, hours, and music

Set the visible category to the selected community category.

Add this external link:

```text
Title: Wat2Do
URL: https://<schoolslug>.wat2do.io
```

Set the business email to `tqiu@uwaterloo.ca` unless the human supplies a newer approved business address.

Leave phone, WhatsApp, and street address unset unless the human explicitly supplies approved values.

Set the profile's timezone to the school's IANA timezone.

Set business hours to **Open 24 hours** for Sunday through Saturday.

Add the business-hours banner to the profile.

Search for `whats a future funk` and select **What's a Future Funk? (Sped Up)** by DezLeppa.

### 13.4 Verify the public profile

Verify all of the following from the public profile view:

- The exact username is `<schoolslug>.wat2do.io`.
- The display name uses the canonical slug.
- The correct primary-background school logo is visible.
- The bio has exactly three lines.
- The official-school mention is linked and correct.
- The Wat2Do link opens the correct school host.
- The community category is correct.
- The email contact option is present.
- Business hours show 24 hours for all seven days.
- The requested music track and artist are present.
- No personal phone number, address, password, token, or unrelated account information is visible.

## 14. Phase J: Follow every organization account

Complete organization discovery and database reconciliation before following accounts.

The following set must come from Supabase:

```sql
select distinct lower(trim(organization.ig)) as instagram_handle
from public.organizations as organization
join public.schools as school on school.id = organization.school_id
where school.slug = '<schoolslug>'
  and nullif(trim(organization.ig), '') is not null
order by instagram_handle;
```

The actual implementation should normalize handles through one shared helper rather than relying on this illustrative SQL alone.

### 14.1 Confirm the Android account identity

Open Instagram on the assigned emulator and confirm the active account is exactly `<schoolslug>.wat2do.io`.

Stop on an authentication loss, security challenge, soft block, or unexpected account identity.

Do not extract a browser cookie as a workaround.

### 14.2 Reconcile and follow the Supabase target set

Use the Supabase query above as the authoritative target list.

Open each normalized handle in the Instagram Android application, confirm the exact profile identity, and follow it from the chapter account.

Record completed, invalid, renamed, missing, and blocked handles in the onboarding evidence packet so the operation can resume without repeating completed follows.

Do not retry a refusal aggressively or mutate a stale organization handle without revalidating it through the normal reviewed organization update path.

Compare the final followed count with the distinct verified Supabase handle count before enabling notifications.

## 15. Phase K: Enable post notifications on Android

Complete follows before enabling notifications.

Open the chapter Instagram profile in the Android application.

Tap the **Following** count to open all followed profiles.

Open the first followed organization.

Tap the bell icon in the top-right corner.

Look for the Instagram entry named **All profiles you follow** or the current equivalent wording.

If Instagram does not expose that entry, stop this phase and record the account, app version, device, screen reached, and screenshot location.

Do not invent a different bulk-notification path or mark notifications complete.

If the consolidated list appears, open it.

Run the existing UI-only script against the explicit device:

```sh
python3 backend/scripts/automate_bell_notifications.py \
  --device <device-serial>
```

The script expects the consolidated list to be open already.

It does not launch Instagram, switch accounts, navigate menus, or verify the expected database handle set.

It walks visible rows, opens each row's bell menu, selects **Posts**, selects **All**, and scrolls until it reaches the end.

After the run, compare the processed count with the distinct verified Instagram-handle count for the school.

Manually spot-check the first, middle, and last processed accounts.

If completeness reconciliation is required and the processed count is insufficient, improve the single existing bell workflow rather than adding a second automation path.

## 16. Phase L: Add the account to the dedicated Automate phone

The account must remain logged into the physical Android phone that runs the Automate notification flow.

Add it as a separate Instagram login and do not join it to a shared Accounts Center.

If the phone or Instagram app reaches an account limit, do not silently evict another chapter or claim completion.

Record the limit and assign the school to another approved device, Android user profile, or operational slot with the human's approval.

Enable Android notification permission for Instagram.

Confirm that post notifications are allowed by the operating system, are not silenced by battery optimization, and are visible to the Automate flow.

Trigger or wait for one real post notification from a followed test organization.

Verify that Automate sends a `new_instagram_post` repository dispatch containing the expected username or post URL and `intended_recipient_id`.

Verify the GitHub **Process Single User** workflow starts.

Verify `backend/services/scraper/single_user.py` resolves the recipient ID to the new school.

Verify the event or no-event result is logged without routing it to another school.

If the observed recipient ID is not yet on the school row, add it through a reviewed migration and rerun the routing test.

Also verify the Automate webhook log appears through the admin diagnostics path when that path is part of the active phone flow.

## 17. Phase M: Configure Meta Instagram publishing

### 17.1 Prepare the non-secret account configuration

Add the new account to `backend/controlbox/instagram_publishing.json` using the established account object shape:

```json
{
  "key": "<schoolslug>",
  "name": "Wat2Do <School display name>",
  "school": "<schoolslug>",
  "instagram_username": "<schoolslug>.wat2do.io",
  "enabled": true
}
```

Inspect `backend/core/controlbox.py` and `backend/tests/core/test_controlbox.py` before editing.

Update count or uniqueness assertions through the existing test path.

Do not place the Instagram user ID or token in the controlbox file.

Read the current `graph_api_version` from the controlbox file instead of copying a version from an old document.

### 17.2 Use the existing Meta developer app

Open the approved Wat2Do Meta developer app at the current [Instagram API setup page](https://developers.facebook.com/apps/27760859503526163/use_cases/customize/?use_case_enum=INSTAGRAM_BUSINESS&selected_tab=API-Setup&product_route=instagram-business&business_id=2084665951934503).

Confirm the product is **Instagram API with Instagram Login**.

Confirm the account is a professional Business account.

Enable only the permissions required by the current publishing service:

```text
instagram_business_basic
instagram_business_content_publish
```

Do not enable messaging, comments, insights, ads, or Page permissions unless a separate approved feature requires them.

### 17.3 Add and accept the Instagram tester

In the Meta app, add the exact username `<schoolslug>.wat2do.io` as an Instagram tester when the dashboard requires a tester role.

While logged into that exact Instagram account, open [Instagram Apps and Websites](https://www.instagram.com/accounts/manage_access/).

Find the tester invitation and accept it.

Return to the Meta dashboard and confirm the account appears in the API setup list.

### 17.4 Generate and verify the access token

Click **Generate access token** for the exact account.

Authenticate as `<schoolslug>.wat2do.io` and approve the required permissions.

Copy the token into a private temporary file or hidden prompt only.

Validate the token identity using the current configured API version and the `/me?fields=id,username` endpoint.

Stop if the returned username is not `<schoolslug>.wat2do.io`.

Do not trust a human-entered label or a user ID copied from the Meta dashboard when the token identity endpoint disagrees.

### 17.5 Import the token securely

Use `backend/scripts/import_instagram_tokens.py` rather than writing to Supabase manually.

The importer validates the token through Instagram, matches the returned username to the configured account, encrypts the token, stores the scoped user ID, and sets expiry and validation metadata.

Use a mode-600 temporary file and remove it immediately after the import.

An example that avoids putting the token directly in shell history is:

```sh
umask 077
instagram_token_file="$(mktemp)"
read -s "instagram_token?Paste Instagram token: "
printf '%s=%s\n' '<schoolslug>' "$instagram_token" > "$instagram_token_file"
unset instagram_token
cd backend
python scripts/import_instagram_tokens.py "$instagram_token_file"
rm "$instagram_token_file"
unset instagram_token_file
```

Run this only in a trusted terminal.

Do not print the temporary file, token, environment, or database ciphertext.

### 17.6 Verify the credential row without exposing the token

Verify only non-secret fields:

```sql
select
  account_key,
  school_id,
  instagram_user_id,
  instagram_username,
  expires_at,
  requires_reauthorization,
  last_validated_at,
  last_refreshed_at,
  refresh_error
from public.instagram_publishing_accounts
where account_key = '<schoolslug>';
```

Confirm that the row references the intended school, username, and scoped user ID.

Confirm `requires_reauthorization` is false.

Never select or display `encrypted_access_token` during routine verification.

## 18. Phase N: Verify publishing readiness

The daily workflow runs `backend/jobs/generate_instagram_posts.py`.

That job refreshes expiring tokens and generates due publishing drafts.

The token lifetime and refresh lead are controlled by `backend/controlbox/instagram_publishing.json`.

Do not hardcode those values in the playbook or a new script.

After the account configuration is deployed and the token is imported:

1. Trigger the approved daily Instagram maintenance workflow or run the job in the approved production-equivalent environment.
2. Confirm the account appears in token refresh statistics.
3. Confirm no identity mismatch or reauthorization error is recorded.
4. Seed or identify eligible upcoming events for the school.
5. Confirm a draft batch is generated for the account.
6. Open the admin Instagram review flow and verify the school name, event selection, cover, caption, and account key.
7. Publish only with explicit approval because this creates a real Instagram post.
8. If a controlled test post is approved, verify it appears on the intended account and remove it manually afterward when requested.

Use `docs/instagram_api_one_account_test.md` only as supporting diagnostic material.

The controlbox and current Meta documentation take precedence over any stale API version or dashboard label in that document.

## 19. Phase O: Verify the application and database

### 19.1 Migration and database checks

Run the local Supabase reset when migrations changed:

```sh
cd backend && supabase db reset
```

Confirm the new school, email domains, academic metadata, organizations, organization types, and required relationships survive the reset or are produced through the documented post-reset import step.

Confirm no organization references an unknown school.

Confirm the school has no duplicate credential row and no credential row points to the wrong school.

### 19.2 Backend checks

Run the backend test suite using the repo's current documented environment.

At minimum, cover school service, allowed-email resolution, organization import and reconciliation, controlbox validation, Instagram credential import, Instagram publishing credentials, single-user routing, follow-source selection, and any new directory adapter.

### 19.3 Frontend checks

Run:

```sh
cd frontend && npm run check
```

Confirm the school appears through the database-backed school search and not through a new hardcoded list.

Confirm `https://<schoolslug>.wat2do.io` resolves to the correct school context.

Confirm the school colors theme the application correctly.

Confirm organization pages and school-filtered event feeds return only the intended school's data.

Do not launch a browser, Playwright, emulator, development server, or preview server unless the human explicitly requests it in the current task.

Record browser-dependent checks for the human when they cannot be run under repo policy.

## 20. Phase P: Seed launch readiness and campus operations

Linear WAT-90 defines additional launch-operating concerns beyond technical onboarding.

Confirm whether the human wants them in scope for the new school.

When they are in scope, complete and record an owner for each item:

| Item | Expected owner | Completion evidence |
| --- | --- | --- |
| Seeded event feed | Central operator or agent | A reviewed set of current events is visible for the school. |
| Posting-rules one-pager | Campus lead with central review | Local university and student-association posting rules are documented. |
| Campus lead recruitment | Human operator | A named lead has accepted the role and access expectations. |
| Branded publishing variant | Product or design owner | The school draft renders correctly with the shared template and brand colors. |
| Community Discord channel | Campus operations | The approved school community channel exists and has an owner. |
| School-level program enablement | Product owner | Any applicable promoter or launch program configuration is enabled through its existing source of truth. |

Do not invent a new feature flag or Discord provisioning path when the current repo has no established owner for it.

Report the gap and obtain approval for the smallest durable implementation.

## 21. Failure handling and retry rules

An AI agent must not interpret persistence as permission to bypass safeguards.

Use these rules:

- If an authoritative school source conflicts with a third-party source, use the authoritative source and record the conflict.
- If the slug collides or remains ambiguous, stop before creating database or social accounts and ask the human.
- If the official directory is inaccessible, exhaust its public API, static HTML, cached official pages, and alternative official directory before using a third-party inventory.
- If a subagent cannot verify an Instagram handle, leave it null.
- If Instagram requests a security challenge, complete only the legitimate challenge with the authorized human.
- If a login fails, record the exact account and failure state without exposing credentials.
- If following is soft-blocked, preserve progress, cool down, and retry within the script's established limits.
- If the consolidated bell list does not exist, stop the notification phase and record it as blocked.
- If the Automate phone reaches an account limit, obtain an approved device assignment instead of evicting an unknown account.
- If the Meta tester invitation does not appear, verify the exact username, professional account state, accepted app role, and logged-in Instagram account before retrying.
- If token identity is wrong, revoke the token and restart generation for the correct account.
- If token import rejects the username, fix the non-secret controlbox configuration or the selected account rather than bypassing validation.
- If a real publishing action would be required for verification, obtain explicit approval immediately before publishing.

## 22. Evidence packet

The final handoff must contain no secrets and must include:

- School name and canonical slug.
- Authoritative source URLs for student email domains, brand colors, academic dates, official Instagram, student association, organization directory, and event directory.
- Migration file name.
- School database row audit with the recipient ID redacted only if the human treats it as sensitive.
- Student email-domain audit.
- Logo file path, dimensions, and visual QA result.
- Organization directory count and final database count.
- Organization coverage counts for Instagram, Discord, directory pages, logos, categories, and association affiliation.
- Organization-type distribution, official student-association directory source, and confirmation that every directory organization uses the association type.
- Subagent job count, match count, unresolved count, and independent verification count.
- Chapter Instagram username and non-secret profile checklist.
- Expected follow count, completed follow count, and unresolved/dead-handle count.
- Bell automation processed count or the documented consolidated-list blocker.
- Automate device assignment and routing verification result.
- Meta API route used, which must be Instagram Login.
- Non-secret publishing credential row fields and token health.
- Publishing draft verification result.
- Exact tests, typecheck, lint, migration reset, and non-browser checks run.
- Every blocked check and the exact reason.

## 23. Final checklist

### Identity and school data

- [ ] Official school name verified.
- [ ] Canonical slug selected from student-email and public-identity evidence.
- [ ] Primary and secondary student email domains verified.
- [ ] IANA timezone verified.
- [ ] Current academic calendar URL and term dates verified.
- [ ] Official school Instagram handle verified.
- [ ] Student association and organization type verified.
- [ ] Official organization directory verified.
- [ ] Official event directory verified.
- [ ] School migration applied and reset-tested.
- [ ] Allowed-email resolution tested.

### Brand and logo

- [ ] Official brand source recorded.
- [ ] Primary background color and secondary mark color recorded in the manifest.
- [ ] Matching colors stored on the school row.
- [ ] `<schoolslug>.jpg` created at the established dimensions.
- [ ] Avatar crop and contrast inspected.

### Organizations

- [ ] Every directory page and organization detail page collected.
- [ ] Instagram, Discord, and Facebook extracted from the authoritative source when present.
- [ ] Database-first import path used.
- [ ] At least 15 subagent browser-search jobs completed across missing Instagram rows.
- [ ] Medium-confidence matches independently verified.
- [ ] Low-confidence matches left null.
- [ ] One coordinator validated and applied results.
- [ ] Organization count reconciled against the authoritative directory.
- [ ] Every organization imported from the official student-association directory received the same verified association type.
- [ ] Organizations added from outside that directory remained `independent` unless separately approved.
- [ ] Database importer explicitly wrote `organization_type` instead of relying on the default.
- [ ] New non-independent type signature and SVG were registered through the shared frontend registry.
- [ ] Organization-type distribution matches the official directory import count.
- [ ] Duplicate handles, invalid URLs, categories, statuses, and organization types audited.

### Instagram account and profile

- [ ] `<schoolslug>.wat2do.io` created on Android.
- [ ] Unique password stored only in the approved password manager.
- [ ] Registration email verified.
- [ ] Account confirmed outside any shared Accounts Center.
- [ ] Professional Business account enabled.
- [ ] Profile image, display name, bio, category, link, contact email, hours, and music verified.

### Following, notifications, and Automate

- [ ] Follow target set read from Supabase.
- [ ] Android account identity confirmed as the chapter account.
- [ ] All verified handles followed or reconciled.
- [ ] Followed count reconciled against the database target count.
- [ ] Consolidated bell list opened or blocker recorded.
- [ ] Post notifications set to `All` and count spot-checked.
- [ ] Account logged into the dedicated Automate phone as a separate login.
- [ ] Real notification generated the expected repository dispatch.
- [ ] Recipient ID stored on the correct school row through a migration.
- [ ] `process-single-user` routed and processed the test correctly.

### Meta publishing

- [ ] Expected non-secret account added to the Instagram publishing controlbox.
- [ ] Instagram API with Instagram Login confirmed.
- [ ] No Facebook Page flow used.
- [ ] Instagram tester invite accepted.
- [ ] Token identity returned the exact chapter username.
- [ ] Token imported with `import_instagram_tokens.py`.
- [ ] Temporary token file removed.
- [ ] Encrypted credential row references the correct school.
- [ ] Token health and refresh path verified.
- [ ] Publishing draft generated and reviewed.

### Verification and handoff

- [ ] `cd backend && supabase db reset` passed when migrations changed.
- [ ] Backend tests passed.
- [ ] `cd frontend && npm run check` passed.
- [ ] Browser-dependent checks were run only with explicit permission or handed to the human.
- [ ] No credentials or session material appear in the diff, logs, screenshots, Linear, or task handoff.
- [ ] Seeded event feed and campus operations scope were confirmed.
- [ ] Evidence packet completed.
