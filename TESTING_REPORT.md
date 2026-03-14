# Wat2Do Frontend Testing Report
**Date:** March 9, 2026  
**Test URL:** http://localhost:5173/  
**Backend API:** http://localhost:8000

## Server Status ✅

### Backend (Port 8000)
- **Status:** Running
- **Process ID:** 7127
- **API Endpoint:** http://localhost:8000/events/
- **Response:** Successfully returning events data

### Frontend (Port 5173)
- **Status:** Running  
- **Process ID:** 7157
- **URL:** http://localhost:5173/
- **Vite Version:** 7.2.7

## Backend Events Data Available

The backend API is serving the following events:

1. **Tech Career Fair**
   - Location: DC 1351
   - Date: March 12, 2026, 2:00 PM - 6:00 PM UTC
   - Category: Career
   - Registration: Required
   - Description: "Meet top tech employers recruiting UW students."

2. **Board Game Night**
   - Location: SLC Great Hall
   - Date: February 5, 2026
   - Category: Social & Games
   - Price: Free ($0.00)
   - Food: Pizza, Chips
   - Registration: Not required
   - Description: "Join us for board games and snacks!"

3. **UWMUN Events** (likely additional events in the response)

## Manual Testing Checklist

### 1. Initial Page Load
- [ ] Navigate to http://localhost:5173/
- [ ] Page loads without errors
- [ ] No blank/white screen
- [ ] Loading spinner appears briefly (if any)

### 2. Event Display
**Expected Behavior:**
- [ ] Events from backend API are displayed as cards
- [ ] At least 2-3 event cards visible (Tech Career Fair, Board Game Night, etc.)
- [ ] Each event card shows:
  - [ ] Event title
  - [ ] Location
  - [ ] Date/time
  - [ ] Category badge
  - [ ] Price (or "Free" badge)
  - [ ] Food badges (if applicable)
  - [ ] Registration indicator (if required)

### 3. Browser Console Check
**Open Developer Tools (F12 or Cmd+Option+I) → Console Tab**

#### Expected: NO Errors
- [ ] No CORS errors
- [ ] No 404 errors from http://localhost:8000
- [ ] No network failures

#### Expected: Successful API Calls
Look for successful network requests:
- [ ] `GET http://localhost:8000/events/` → Status 200
- [ ] Response contains array of event objects

#### Potential Issues to Check:
- ❌ CORS Error: "Access to fetch at 'http://localhost:8000/events/' from origin 'http://localhost:5173' has been blocked"
  - **Solution:** Backend needs CORS configuration
- ❌ 404 Error: Events endpoint not found
  - **Solution:** Check backend routes
- ❌ Network Error: "Failed to fetch"
  - **Solution:** Backend not running or wrong port

### 4. Network Tab Check
**Open Developer Tools → Network Tab**

- [ ] Filter by "Fetch/XHR"
- [ ] Look for request to `/events/`
- [ ] Click on the request to see:
  - [ ] Status: 200 OK
  - [ ] Response: JSON array of events
  - [ ] Response Headers: Include CORS headers if needed

### 5. Search Functionality
- [ ] Search bar is visible at the top
- [ ] Placeholder text appears (likely "Search events...")
- [ ] Type "Tech" → Tech Career Fair appears
- [ ] Type "Board" → Board Game Night appears
- [ ] Clear search → All events reappear

### 6. Event Count Display
- [ ] Event count shows at the top (e.g., "3 events")
- [ ] Count updates when searching/filtering
- [ ] "Clear all filters" button visible

### 7. UI Elements
- [ ] Dark mode toggle works (if implemented)
- [ ] Responsive layout (try resizing browser)
- [ ] Smooth scrolling
- [ ] No layout shift or jumpy content

### 8. Loading States
- [ ] Initial load shows events immediately (uses local cache)
- [ ] No long blank screen
- [ ] Smooth transition when backend data loads

### 9. Empty States
To test empty state:
- [ ] Search for something that doesn't exist (e.g., "zzzzz")
- [ ] Should show "No events found" or similar message

## Code Architecture Review

### API Integration
The frontend uses a **hybrid approach**:

1. **Initial Load:** Shows events from local cache immediately (no blank screen)
2. **Background Fetch:** Fetches from backend API at http://localhost:8000/events/
3. **Merge:** Combines backend events with any user-created local events
4. **Deduplication:** Removes duplicate events by ID

### API Client Configuration
- **Base URL:** `http://localhost:8000` (from `frontend/.env`)
- **Client:** `frontend/src/shared/services/apiClient.ts`
- **Events API:** `frontend/src/features/events/api/events.api.ts`

### Key Components
- **App.tsx:** Main app with routing
- **EventsPage.tsx:** Main events page component
- **EventList:** Renders event cards
- **useEventsStore:** Manages events state and API calls

## Expected API Response Format

The backend should return events in this format:

```json
[
  {
    "id": 3,
    "title": "Tech Career Fair",
    "description": "Meet top tech employers recruiting UW students.",
    "location": "DC 1351",
    "dtstart_utc": "2026-03-12T14:00:00Z",
    "dtend_utc": "2026-03-12T18:00:00Z",
    "price": null,
    "food": null,
    "registration": true,
    "category": "Career",
    "school": "University of Waterloo",
    "club_type": "University",
    "added_at": "2026-03-09T16:07:49.586461Z"
  }
]
```

## Common Issues & Solutions

### Issue 1: Events Not Displaying
**Symptoms:** Blank page or "0 events"

**Debug Steps:**
1. Check browser console for errors
2. Check Network tab for failed API calls
3. Verify backend is running: `curl http://localhost:8000/events/`
4. Check if frontend is using correct API URL in `.env`

### Issue 2: CORS Errors
**Symptoms:** Console shows CORS policy error

**Solution:** Backend needs to allow http://localhost:5173
```python
# In backend/main.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Issue 3: Wrong Date Format
**Symptoms:** Events show wrong dates or "Invalid Date"

**Debug:** Check if backend returns ISO 8601 format (`dtstart_utc`)

### Issue 4: Missing Event Fields
**Symptoms:** Event cards missing information

**Debug:** Check if backend response includes all required fields:
- `id`, `title`, `location`, `dtstart_utc`, `category`

## Performance Expectations

- **Initial Load:** < 500ms (using local cache)
- **Backend Fetch:** 1-2 seconds (background)
- **Search/Filter:** Instant (client-side)
- **Smooth Scrolling:** 60 FPS

## Accessibility Check

- [ ] Keyboard navigation works (Tab through elements)
- [ ] Screen reader announces event count
- [ ] Focus indicators visible
- [ ] Color contrast meets WCAG standards

## Mobile Testing (Optional)

- [ ] Open DevTools → Toggle device toolbar
- [ ] Test on iPhone/Android viewport
- [ ] Touch interactions work
- [ ] No horizontal scroll
- [ ] Readable text size

## Test Results Summary

### ✅ What's Working
- Backend API running on port 8000
- Frontend running on port 5173
- Events API endpoint responding with data
- Events data includes: Tech Career Fair, Board Game Night, etc.

### ⏳ To Verify Manually
- Events displaying correctly in UI
- Search/filter functionality
- No console errors
- CORS configuration
- Event cards rendering properly

### 📝 Notes
- Frontend uses hybrid approach (local cache + API)
- API base URL: http://localhost:8000
- Events are fetched on component mount
- Local events merged with backend events

---

## How to Test

1. **Open the app:** http://localhost:5173/
2. **Open DevTools:** Press F12 (or Cmd+Option+I on Mac)
3. **Check Console tab:** Look for errors
4. **Check Network tab:** Look for `/events/` request
5. **Verify events display:** Should see event cards
6. **Test search:** Type in search bar
7. **Take screenshots:** Capture any issues

## Screenshots to Capture

Please take screenshots of:
1. Full page view showing events
2. Browser console (showing any errors or successful API calls)
3. Network tab showing `/events/` request
4. Individual event card (close-up)
5. Search functionality in action
6. Empty state (if applicable)

---

**Tester:** [Your Name]  
**Date Tested:** [Date]  
**Browser:** [Chrome/Firefox/Safari]  
**OS:** [macOS/Windows/Linux]
