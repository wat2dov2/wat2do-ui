# Clubs Page Test Report
**Date:** March 9, 2026  
**URL:** http://localhost:5173/clubs  
**Backend API:** http://localhost:8000

## Test Results Summary

### ✅ Backend API Status
- **Endpoint:** `GET http://localhost:8000/clubs/`
- **Status:** Working correctly
- **Response:** Returns 3 seeded clubs as expected

```json
[
  {
    "id": 1,
    "club_name": "Pre-Pharmacy, UW",
    "categories": ["Academic"],
    "club_page": "152",
    "ig": "uwprepharmacy",
    "discord": null,
    "club_type": "WUSA"
  },
  {
    "id": 2,
    "club_name": "UW Board Games Club",
    "categories": ["Social & Games"],
    "club_page": "200",
    "ig": "uwboardgames",
    "discord": "uwboardgames",
    "club_type": "WUSA"
  },
  {
    "id": 3,
    "club_name": "UW Computer Science Club",
    "categories": ["Academic", "Technology"],
    "club_page": "310",
    "ig": "uwcsclub",
    "discord": "uwcsclub",
    "club_type": "WUSA"
  }
]
```

### Expected Frontend Behavior

Based on code analysis, the clubs page should display:

#### 1. **Page Header**
- Title: "Clubs" (translated via i18n)
- Description: Club browsing description

#### 2. **Search Bar**
- Search icon on the left
- Placeholder text for searching clubs
- Clear button (X) appears when text is entered
- Real-time filtering as you type

#### 3. **Category Filter Chips**
- Should display up to 10 category chips
- Categories extracted from backend clubs:
  - "Academic" (from Pre-Pharmacy, UW and CS Club)
  - "Social & Games" (from Board Games Club)
  - "Technology" (from CS Club)
- Chips are clickable to toggle filter
- Active chips show with primary color background
- Inactive chips show with muted background

#### 4. **Active Filters Display**
- Shows selected categories as badges
- Each badge has an X button to remove the filter
- Only visible when categories are selected

#### 5. **Results Count**
- Displays "3 clubs" (or "1 club" if filtered to one)
- Bold, large text

#### 6. **Clubs Grid**
- 4-column grid on extra-large screens
- 3-column on large screens
- 2-column on medium screens
- 1-column on small screens
- Each club displayed as a ClubCard component

#### 7. **Club Cards**
Each card should show:
- **Club Name** (bold, 2-line clamp)
- **Category Badges** (max 2 shown, with "+N" if more)
  - Color-coded by category
  - "Academic" → academic color scheme
  - "Social & Games" → default color scheme
  - "Technology" → default color scheme
- **Club Type Tag** (WUSA)
- **Social Links**:
  - Instagram icon + handle (if present)
  - Discord icon + "Discord" text (if present)
- **"View Club Page" button** with external link icon

### Test Scenarios to Verify

#### Scenario 1: Initial Page Load
**Expected:**
- Loading state briefly shows
- 3 clubs displayed in grid
- Category chips show: "Academic", "Social & Games", "Technology"
- Results count shows "3 clubs"

#### Scenario 2: Search Functionality
**Test:** Type "Board" in search box

**Expected:**
- Filters to show only "UW Board Games Club"
- Results count updates to "1 club"
- Clear button (X) appears in search box
- Category filters remain available

**Test:** Type "Computer" in search box

**Expected:**
- Filters to show only "UW Computer Science Club"
- Results count updates to "1 club"

**Test:** Type "xyz123" (non-matching)

**Expected:**
- Shows "No clubs found" empty state
- Search icon in empty state
- Helpful message about trying different search terms

#### Scenario 3: Category Filtering
**Test:** Click "Academic" category chip

**Expected:**
- Chip becomes highlighted (primary color)
- Shows 2 clubs: "Pre-Pharmacy, UW" and "UW Computer Science Club"
- Results count shows "2 clubs"
- Active filter badge appears below chips

**Test:** Click "Social & Games" category chip

**Expected:**
- Shows 1 club: "UW Board Games Club"
- Results count shows "1 club"

**Test:** Click both "Academic" and "Technology" chips

**Expected:**
- Shows clubs that have EITHER category (OR logic)
- Should show "UW Computer Science Club" (has both)
- Should also show "Pre-Pharmacy, UW" (has Academic)

#### Scenario 4: Combined Search + Filter
**Test:** Type "UW" and select "Academic" category

**Expected:**
- Shows clubs matching search AND having the category
- Should show: "Pre-Pharmacy, UW" and "UW Computer Science Club"

#### Scenario 5: Social Links
**Test:** Click Instagram icon on "Pre-Pharmacy, UW"

**Expected:**
- Opens https://instagram.com/uwprepharmacy in new tab
- Click event doesn't trigger card click

**Test:** Click Discord icon on "UW Board Games Club"

**Expected:**
- Opens Discord link in new tab
- Click event doesn't trigger card click

#### Scenario 6: Club Page Button
**Test:** Click "View Club Page" on any club

**Expected:**
- Since club_page is just a number (e.g., "152"), the button won't open a link
- **⚠️ POTENTIAL ISSUE:** The code checks if `club_page.startsWith("http")` but the backend returns just numbers

### Known Issues / Observations

#### ⚠️ Issue 1: Club Page Links
The backend returns `club_page` as just a number (e.g., "152", "200", "310"), but the frontend ClubCard component only opens links if they start with "http". This means the "View Club Page" button won't do anything for these clubs.

**Recommendation:** Either:
1. Update backend to return full URLs
2. Update frontend to construct URLs from the page numbers
3. Update frontend to handle both cases

#### ⚠️ Issue 2: Category Name Mismatch
The backend seeds have "Social & Games" but the mock data has "Games, Recreational and Social". The frontend should handle this gracefully with its translation system.

### Console Errors to Check

Open browser DevTools (F12) and check for:
- ❌ Network errors (failed API calls)
- ❌ React errors (component rendering issues)
- ❌ Translation key errors (missing i18n keys)
- ❌ CORS errors (should not occur since both run on localhost)

### API Configuration

The frontend is configured to use:
- **API Base URL:** `http://localhost:8000` (from `.env`)
- **Fallback:** If API fails, falls back to mock data (29 clubs)

### Manual Testing Checklist

- [ ] Navigate to http://localhost:5173/clubs
- [ ] Verify 3 clubs are displayed
- [ ] Check that club names match backend data
- [ ] Test search box with "Board" - should filter to 1 club
- [ ] Test search box with "Computer" - should filter to 1 club
- [ ] Clear search and verify all clubs return
- [ ] Click "Academic" category chip - should show 2 clubs
- [ ] Click "Social & Games" category chip - should show 1 club
- [ ] Verify active filter badges appear
- [ ] Click X on active filter badge to remove it
- [ ] Test Instagram links open correctly
- [ ] Test Discord links open correctly
- [ ] Check responsive design (resize browser window)
- [ ] Open DevTools Console - verify no errors
- [ ] Open DevTools Network tab - verify API call succeeds

### Screenshots to Capture

1. Initial page load (all 3 clubs)
2. Search results for "Board"
3. Category filter applied (Academic)
4. Active filters display
5. Empty state (search for "xyz123")
6. Individual club card details
7. Console tab (showing no errors)
8. Network tab (showing successful API call)

---

## Conclusion

The clubs page should be fully functional with:
- ✅ Backend API working correctly
- ✅ Frontend properly configured to fetch from API
- ✅ Search and filter functionality implemented
- ✅ Responsive grid layout
- ⚠️ Minor issue with club page links (needs investigation)

**Next Steps:**
1. Manually test the page following the checklist above
2. Take screenshots of key states
3. Fix the club page link issue if confirmed
4. Consider adding more seed data for better testing
