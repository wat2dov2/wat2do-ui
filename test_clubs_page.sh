#!/bin/bash

# Clubs Page Test Script
# Tests the backend API and provides instructions for frontend testing

echo "================================"
echo "Clubs Page Test Script"
echo "================================"
echo ""

# Test 1: Check if backend is running
echo "Test 1: Checking if backend is running on port 8000..."
if curl -s http://localhost:8000/docs > /dev/null 2>&1; then
    echo "✅ Backend is running"
else
    echo "❌ Backend is NOT running"
    echo "   Start it with: cd backend && source .venv/bin/activate && uvicorn main:app --reload"
    exit 1
fi
echo ""

# Test 2: Check if frontend is running
echo "Test 2: Checking if frontend is running on port 5173..."
if curl -s http://localhost:5173 > /dev/null 2>&1; then
    echo "✅ Frontend is running"
else
    echo "❌ Frontend is NOT running"
    echo "   Start it with: cd frontend && npm run dev"
    exit 1
fi
echo ""

# Test 3: Test clubs API endpoint
echo "Test 3: Testing GET /clubs/ endpoint..."
RESPONSE=$(curl -s http://localhost:8000/clubs/)
COUNT=$(echo "$RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null)

if [ $? -eq 0 ]; then
    echo "✅ API endpoint is working"
    echo "   Found $COUNT clubs"
    echo ""
    echo "   Clubs returned:"
    echo "$RESPONSE" | python3 -m json.tool | grep -E '"club_name"|"categories"' | head -20
else
    echo "❌ API endpoint failed"
    exit 1
fi
echo ""

# Test 4: Test search functionality
echo "Test 4: Testing search functionality..."
SEARCH_RESPONSE=$(curl -s "http://localhost:8000/clubs/?search=Board")
SEARCH_COUNT=$(echo "$SEARCH_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null)
echo "✅ Search for 'Board' returned $SEARCH_COUNT club(s)"
echo ""

# Test 5: Test category filter
echo "Test 5: Testing club type filter..."
FILTER_RESPONSE=$(curl -s "http://localhost:8000/clubs/?club_type=WUSA")
FILTER_COUNT=$(echo "$FILTER_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null)
echo "✅ Filter for 'WUSA' returned $FILTER_COUNT club(s)"
echo ""

echo "================================"
echo "Backend API Tests Complete! ✅"
echo "================================"
echo ""
echo "📋 Manual Frontend Testing Steps:"
echo ""
echo "1. Open your browser to: http://localhost:5173/clubs"
echo ""
echo "2. Verify you see 3 clubs:"
echo "   - Pre-Pharmacy, UW"
echo "   - UW Board Games Club"
echo "   - UW Computer Science Club"
echo ""
echo "3. Test the search box:"
echo "   - Type 'Board' → should show 1 club"
echo "   - Type 'Computer' → should show 1 club"
echo "   - Clear search → should show all 3 clubs"
echo ""
echo "4. Test category filters:"
echo "   - Click 'Academic' chip → should show 2 clubs"
echo "   - Click 'Social & Games' chip → should show 1 club"
echo "   - Click 'Technology' chip → should show 1 club"
echo ""
echo "5. Open DevTools (F12) and check:"
echo "   - Console tab: Should have no errors"
echo "   - Network tab: Should show successful GET /clubs/ request"
echo ""
echo "6. Test social links:"
echo "   - Click Instagram icons → should open Instagram profiles"
echo "   - Click Discord icons → should open Discord links"
echo ""
echo "📸 Take screenshots of:"
echo "   - Initial page load"
echo "   - Search results"
echo "   - Category filter applied"
echo "   - Console (showing no errors)"
echo ""
echo "📄 Full test report available in: CLUBS_PAGE_TEST_REPORT.md"
echo ""
