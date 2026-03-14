# Clubs Page Visual Guide

## What You Should See at http://localhost:5173/clubs

### 🎯 Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Clubs                                                      │
│  Browse and discover student clubs at UW                   │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ 🔍  Search clubs...                                   │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  [Academic] [Social & Games] [Technology]                  │
│                                                             │
│  3 clubs                                                    │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Pre-Pharmacy │  │ UW Board     │  │ UW Computer  │    │
│  │ UW           │  │ Games Club   │  │ Science Club │    │
│  │              │  │              │  │              │    │
│  │ [Academic]   │  │ [Social &    │  │ [Academic]   │    │
│  │              │  │  Games]      │  │ [Technology] │    │
│  │ 🏷️ WUSA      │  │ 🏷️ WUSA      │  │ 🏷️ WUSA      │    │
│  │              │  │              │  │              │    │
│  │ 📷 uwpre...  │  │ 📷 uwboard..│  │ 📷 uwcsclub  │    │
│  │              │  │ 💬 Discord   │  │ 💬 Discord   │    │
│  │              │  │              │  │              │    │
│  │ [View Club   │  │ [View Club   │  │ [View Club   │    │
│  │  Page 🔗]    │  │  Page 🔗]    │  │  Page 🔗]    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 📊 Expected Data

#### Club 1: Pre-Pharmacy, UW
- **Name:** Pre-Pharmacy, UW
- **Categories:** Academic (blue/academic color)
- **Type:** WUSA
- **Instagram:** uwprepharmacy
- **Discord:** None
- **Club Page:** 152

#### Club 2: UW Board Games Club
- **Name:** UW Board Games Club
- **Categories:** Social & Games (default color)
- **Type:** WUSA
- **Instagram:** uwboardgames
- **Discord:** uwboardgames
- **Club Page:** 200

#### Club 3: UW Computer Science Club
- **Name:** UW Computer Science Club
- **Categories:** Academic, Technology (shows first 2, both default color)
- **Type:** WUSA
- **Instagram:** uwcsclub
- **Discord:** uwcsclub
- **Club Page:** 310

### 🔍 Search Behavior

#### Search: "Board"
```
┌─────────────────────────────────────────────────────────────┐
│  ┌───────────────────────────────────────────────────────┐ │
│  │ 🔍  Board                                          [X]│ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  [Academic] [Social & Games] [Technology]                  │
│                                                             │
│  1 club                                                     │
│                                                             │
│  ┌──────────────┐                                          │
│  │ UW Board     │                                          │
│  │ Games Club   │                                          │
│  │              │                                          │
│  │ [Social &    │                                          │
│  │  Games]      │                                          │
│  │ 🏷️ WUSA      │                                          │
│  │              │                                          │
│  │ 📷 uwboard..│                                          │
│  │ 💬 Discord   │                                          │
│  │              │                                          │
│  │ [View Club   │                                          │
│  │  Page 🔗]    │                                          │
│  └──────────────┘                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Search: "Computer"
```
Result: 1 club (UW Computer Science Club)
```

#### Search: "xyz123" (no matches)
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                    🔍                                       │
│                                                             │
│              No clubs found                                 │
│                                                             │
│     Try adjusting your search or filters                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 🏷️ Category Filter Behavior

#### Click "Academic" chip:
```
Active Filters: [Academic ×]

2 clubs displayed:
- Pre-Pharmacy, UW
- UW Computer Science Club
```

#### Click "Social & Games" chip:
```
Active Filters: [Social & Games ×]

1 club displayed:
- UW Board Games Club
```

#### Click "Technology" chip:
```
Active Filters: [Technology ×]

1 club displayed:
- UW Computer Science Club
```

#### Click both "Academic" AND "Technology":
```
Active Filters: [Academic ×] [Technology ×]

2 clubs displayed (OR logic):
- Pre-Pharmacy, UW (has Academic)
- UW Computer Science Club (has both)
```

### 🌐 Network Activity (DevTools)

#### Network Tab:
```
Request URL: http://localhost:8000/clubs/
Request Method: GET
Status Code: 200 OK
Response Type: application/json

Response Body:
[
  {
    "id": 1,
    "club_name": "Pre-Pharmacy, UW",
    "categories": ["Academic"],
    ...
  },
  ...
]
```

#### Console Tab:
```
Should be clean with no errors ✅

If you see errors like:
❌ Failed to fetch
❌ Network error
❌ CORS error
→ Check that backend is running on port 8000
```

### 🎨 Visual Elements

#### Colors:
- **Academic category badge:** Blue/teal background
- **Other categories:** Gray/muted background
- **Active filter chips:** Primary color (blue) background
- **Inactive filter chips:** Gray background
- **Hover effects:** Cards lift slightly, opacity changes

#### Icons:
- 🔍 Search icon (left side of search box)
- ❌ Clear icon (right side when typing)
- 📷 Instagram icon (in social links)
- 💬 Discord icon (in social links)
- 🏷️ Tag icon (next to club type)
- 🔗 External link icon (in "View Club Page" button)

#### Typography:
- **Page title:** Large, bold "Clubs"
- **Club names:** Bold, medium size
- **Categories:** Small, uppercase
- **Results count:** Large, bold
- **Social links:** Small, gray text

### 📱 Responsive Behavior

#### Desktop (>1280px):
- 4 columns of club cards

#### Laptop (1024px-1280px):
- 3 columns of club cards

#### Tablet (768px-1024px):
- 2 columns of club cards

#### Mobile (<768px):
- 1 column of club cards
- Full-width search bar
- Stacked category chips

### ⚠️ Known Issues to Verify

1. **Club Page Button:**
   - Clicking "View Club Page" may not do anything
   - Backend returns just numbers ("152", "200", "310")
   - Frontend expects URLs starting with "http"
   - This is a known limitation to fix

2. **Category Translation:**
   - Categories should be translated if i18n keys exist
   - May fall back to English if translations missing

### ✅ Success Criteria

The page is working correctly if:
- ✅ 3 clubs are displayed on initial load
- ✅ Search filters clubs in real-time
- ✅ Category chips filter correctly
- ✅ Instagram links open to correct profiles
- ✅ Discord links work
- ✅ No console errors
- ✅ Network request to `/clubs/` succeeds
- ✅ Responsive layout works on different screen sizes
- ✅ Loading state appears briefly on page load

---

## Quick Test Commands

```bash
# Run the automated test script
./test_clubs_page.sh

# Test API directly
curl http://localhost:8000/clubs/ | python3 -m json.tool

# Test search
curl "http://localhost:8000/clubs/?search=Board" | python3 -m json.tool

# Check if servers are running
lsof -i :8000  # Backend
lsof -i :5173  # Frontend
```

## Troubleshooting

### If you see no clubs:
1. Check backend is running: `curl http://localhost:8000/clubs/`
2. Check browser console for errors
3. Check Network tab for failed requests
4. Verify `.env` has `VITE_API_URL=http://localhost:8000`

### If search doesn't work:
1. Open DevTools Console
2. Type in search box
3. Check for JavaScript errors
4. Verify filteredClubs state is updating

### If categories don't show:
1. Backend may not have seeded data
2. Run: `cd backend && python seeds/run.py`
3. Refresh the page

---

**Last Updated:** March 9, 2026  
**Test Status:** ✅ Backend API verified working  
**Manual Testing:** Required (browser automation not available)
