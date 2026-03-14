# Frontend Testing Summary - Wat2Do Events Page

## 🎯 Test Objective
Verify that the frontend at http://localhost:5173/ successfully displays events from the backend API at http://localhost:8000/events/

---

## ✅ Backend Status (Verified)

### API Endpoint: `GET http://localhost:8000/events/`
**Status:** ✅ Working  
**Response Time:** ~1300ms  
**Events Returned:** 3 events

### Events Available:
1. **Tech Career Fair**
   - Category: Career
   - Location: DC 1351
   - Date: March 12, 2026, 2:00 PM - 6:00 PM
   - Registration: Required
   - Description: "Meet top tech employers recruiting UW students."

2. **Board Game Night**
   - Category: Social & Games
   - Location: SLC Great Hall
   - Date: February 5, 2026
   - Price: Free ($0.00)
   - Food: Pizza, Chips
   - Registration: Not required

3. **UWMUN Events**
   - Category: Academic
   - (Additional details in API response)

### CORS Configuration
✅ Backend has CORS enabled with `allow_origins=["*"]` - no CORS issues expected

---

## 🏗️ Frontend Architecture

### Data Flow
```
1. Page Load → EventsPageContainer
2. useAppEvents() → useEventsStore()
3. Initial State: loadAllEvents() (local cache - instant display)
4. useEffect: fetchAllEvents() (background API call)
5. Merge: API events + local events → deduplicate
6. Render: EventList → EventCard components
```

### Key Components

#### 1. **EventsPageContainer** (`frontend/src/features/events/pages/EventsPageContainer.tsx`)
- Main container for the events page
- Handles search, filters, and view modes
- Wraps EventList with EventsProvider context

#### 2. **EventList** (`frontend/src/features/events/components/EventList.tsx`)
- Renders grid of event cards
- Shows empty state if no events
- Sorts promoted events to top
- Uses `content-visibility: auto` for performance

#### 3. **useEventsStore** (`frontend/src/features/events/store/events.store.ts`)
- Manages events state
- Loads local cache synchronously on mount
- Fetches from API in background via `fetchAllEvents()`
- Merges and deduplicates events

#### 4. **API Client** (`frontend/src/shared/services/apiClient.ts`)
- Base URL: `http://localhost:8000` (from `.env`)
- Handles authentication tokens
- Makes fetch requests to backend

---

## 🧪 What to Test Manually

### 1. Open the Application
```bash
# Open in browser:
http://localhost:5173/
```

### 2. Expected UI Elements

#### Search Bar
- [ ] Search input field at the top
- [ ] Placeholder text: "Search events..."
- [ ] View mode tabs (Grid/Calendar/Map)

#### Quick Filters
- [ ] "Free Food" chip (with count badge)
- [ ] "For You" chip (if profile completed)
- [ ] "Saved" chip (if profile completed)
- [ ] "More Filters" button

#### Event Count
- [ ] Shows "3 events" (or current count)
- [ ] Updates when filtering

#### Event Cards
Each event card should display:
- [ ] Event title (e.g., "Tech Career Fair")
- [ ] Category badge (e.g., "Career")
- [ ] Location (e.g., "📍 DC 1351")
- [ ] Date/time
- [ ] Price badge ("Free" or "$X")
- [ ] Food badges (if applicable, e.g., "🍕 pizza")
- [ ] Registration indicator (if required)
- [ ] Save button (heart icon)

### 3. Browser Developer Tools Check

#### Console Tab (F12)
**Expected: No errors**

Look for:
- ✅ No CORS errors
- ✅ No 404 errors
- ✅ No "Failed to fetch" errors
- ✅ Successful API calls logged

**If you see errors:**
- ❌ CORS error → Backend CORS config issue (unlikely, already verified)
- ❌ 404 error → Backend route not found
- ❌ Network error → Backend not running or wrong port

#### Network Tab
1. Filter by "Fetch/XHR"
2. Look for request to `events/`
3. Click on the request:
   - **Status:** Should be `200 OK`
   - **Response:** JSON array of events
   - **Time:** ~1-2 seconds

**Example successful request:**
```
Request URL: http://localhost:8000/events/
Request Method: GET
Status Code: 200 OK
Response: [{"id": 3, "title": "Tech Career Fair", ...}, ...]
```

### 4. Functional Tests

#### Search
- [ ] Type "Tech" → Tech Career Fair appears
- [ ] Type "Board" → Board Game Night appears
- [ ] Type "xyz" → "No events found" message
- [ ] Clear search → All events reappear

#### Filters
- [ ] Click "Free Food" → Only events with food
- [ ] Click "More Filters" → Dropdown opens
- [ ] Select category → Events filtered
- [ ] Click "Clear all filters" → All events shown

#### Event Interaction
- [ ] Click event card → Details modal opens
- [ ] Click heart icon → Event saved (heart fills)
- [ ] Click heart again → Event unsaved

---

## 🐛 Troubleshooting

### Issue: No Events Displayed

**Symptoms:**
- Page shows "0 events" or empty state
- No event cards visible

**Debug Steps:**
1. Open browser console (F12)
2. Check for errors
3. Check Network tab for failed `/events/` request
4. Verify backend is running:
   ```bash
   curl http://localhost:8000/events/
   ```

**Possible Causes:**
- Backend not running
- API endpoint returning empty array
- Frontend not making API call
- JavaScript error preventing render

### Issue: CORS Error

**Symptoms:**
- Console shows: "Access to fetch... has been blocked by CORS policy"

**Solution:**
- Verify backend `main.py` has CORS middleware (already confirmed ✅)
- Restart backend server
- Clear browser cache

### Issue: Wrong/Missing Data

**Symptoms:**
- Events display but missing fields (location, date, etc.)
- Date shows "Invalid Date"

**Debug:**
1. Check Network tab → Response data format
2. Verify backend returns all required fields:
   - `id`, `title`, `location`, `dtstart_utc`, `category`
3. Check console for transformation errors

---

## 📊 Performance Expectations

### Load Times
- **Initial render:** < 100ms (local cache)
- **API fetch:** 1-2 seconds (background)
- **Search/filter:** Instant (client-side)

### Rendering
- **Grid layout:** 4 columns on desktop
- **Smooth scrolling:** 60 FPS
- **No layout shift:** Content stable on load

---

## 🧪 Quick Test Script

I've created a standalone test page for you:

### File: `test-api.html`
**Location:** `/Users/tonyqiu/Desktop/projects/2026/wat2do-v2/test-api.html`

**How to use:**
1. Open `test-api.html` in your browser
2. It will automatically test the API connection
3. Shows success/error status
4. Displays events in a simple format
5. Shows raw JSON response

**To open:**
```bash
open /Users/tonyqiu/Desktop/projects/2026/wat2do-v2/test-api.html
```

Or drag the file into your browser.

---

## 📸 Screenshots to Capture

Please take screenshots of:

1. **Full page view** - Showing all event cards
2. **Browser console** - Showing no errors (or any errors present)
3. **Network tab** - Showing successful `/events/` request
4. **Event card close-up** - Showing all event details
5. **Search in action** - Showing filtered results
6. **Empty state** - Search for "xyz" to trigger

---

## ✅ Expected Test Results

### If Everything Works:
- ✅ Page loads instantly (local cache)
- ✅ 3 event cards displayed in grid
- ✅ Events show: Tech Career Fair, Board Game Night, UWMUN Events
- ✅ Search works
- ✅ Filters work
- ✅ No console errors
- ✅ Network tab shows successful API call
- ✅ Event details complete (title, location, date, category)

### Success Criteria:
- [ ] Events from backend API are displayed
- [ ] All 3 events visible
- [ ] Event details are complete and correct
- [ ] No CORS errors in console
- [ ] API call succeeds (200 OK)
- [ ] Search functionality works
- [ ] UI is responsive and smooth

---

## 🔍 What I've Verified

✅ **Backend API**
- Running on port 8000
- `/events/` endpoint responding
- Returns 3 events with complete data
- CORS enabled

✅ **Frontend Server**
- Running on port 5173
- Vite dev server active
- No build errors

✅ **Code Architecture**
- API client configured correctly
- Events store fetches from backend
- Components render events properly
- Error handling in place

✅ **Configuration**
- `.env` has correct API URL
- CORS allows all origins
- No authentication required for GET /events/

---

## 📝 Next Steps

1. **Open the app:** http://localhost:5173/
2. **Verify events display:** Should see 3 event cards
3. **Check console:** Should have no errors
4. **Test search:** Type "Tech" and verify filtering
5. **Report results:** Take screenshots and note any issues

---

## 🆘 Need Help?

If you encounter issues:

1. **Check backend logs:**
   ```bash
   # Look at terminal running backend
   # Should show incoming GET requests
   ```

2. **Test API directly:**
   ```bash
   curl http://localhost:8000/events/ | python3 -m json.tool
   ```

3. **Check frontend console:**
   - F12 → Console tab
   - Look for red errors

4. **Restart servers:**
   ```bash
   # Backend
   cd backend && . .venv/bin/activate && uvicorn main:app --reload --port 8000
   
   # Frontend
   cd frontend && npm run dev
   ```

---

**Test Date:** March 9, 2026  
**Tester:** [Your Name]  
**Status:** Ready for manual testing ✅
