# Instagram & Club Metadata Scraping Prompt

Use this prompt to coordinate an AI agent (like Claude Cowork) to scrape a school's club directory, find social media handles, map the categories, and append/update the master Excel spreadsheet.

---

## The Prompt

```markdown
Role: Club Scraper & Metadata Analyst
Task: Gather club list, Instagram URLs, handles, and metadata for a given university from its club directory website, and append the canonical data to the master spreadsheet.

Inputs to Use:
- School Name: [INSERT CANONICAL SCHOOL NAME - e.g., Wilfrid Laurier University]
- School Short Name (XLSX): [INSERT SHORT NAME - e.g., Laurier]
- Club Directory URL: [INSERT DIRECTORY URL - e.g., https://laurier.campuslabs.ca/engage/organizations]

Steps to Execute:

1. SCRAPE Directory Index & Detail Pages:
   - Use a scraping subagent (web browsing/scraping tools) to load the Club Directory URL.
   - Extract the list of all registered student clubs (Name, Directory detail page URL, and optional Category labels).
   - For each club, scrape its detail page to find any explicitly listed Instagram link, website, or email.

2. SEARCH for Missing Instagram Handles:
   - For clubs with no Instagram URL on their detail page, invoke web search subagents (e.g. Google Search) using target queries:
     `site:instagram.com "[School Name]" "[Club Name]"`
   - Cross-reference search results to verify that the retrieved Instagram profile is active and belongs to the correct student organization.
   - Determine and set the 'IG Source' field:
     - `confirmed`: Explicitly verified / cross-linked.
     - `found`: Found via search, high confidence match.
     - `listing`: Extracted directly from the directory details page.
     - `low_confidence`: Search match but profile has low activity or generic handle.
     - `not_found`: No handle could be resolved.

3. MAP to Canonical Taxonomy Categories:
   - Semantically map each club's category to one or more of the 9 canonical organization categories:
     1. Business and Entrepreneurial
     2. Charitable, Community Service & International Development
     3. Creative Arts, Dance and Music
     4. Environmental and Sustainability
     5. Games, Recreational and Social
     6. Health Promotion
     7. Media, Publications and Web Development
     8. Political and Social Awareness
     9. Religious and Spiritual
   - If multiple categories apply, separate them with a comma-space (e.g., "Business and Entrepreneurial, Games, Recreational and Social").
   - If a category cannot be mapped, label it accurately as is so the validator can flag it, or review the closest match.

4. UPDATE Master Excel Spreadsheet:
   - Open the master workbook: `backend/services/scraper/all_schools_student_clubs_master.xlsx`.
   - Append or update rows matching these exact columns:
     - Column A: `School` (use the School Short Name)
     - Column B: `Name` (Club Name)
     - Column C: `Category` (Mapped comma-separated categories)
     - Column D: `Campus` (Campus name or blank)
     - Column E: `Directory URL` (URL of the club's detail page in the directory)
     - Column F: `Instagram URL` (Canonical Instagram link or blank)
     - Column G: `Instagram Handle` (IG handle without '@')
     - Column H: `IG Source` (confirmed, found, listing, etc.)
   - Ensure the rows start at row 3 (rows 1 and 2 are header rows).

5. RUN Verification Checks:
   - Run the import script in dry-run mode to verify the format, categories, and school name are 100% correct:
     `cd backend && .venv/bin/python scripts/import_master_clubs_xlsx.py`
   - Ensure that the verification run does not abort with validation errors.
```
