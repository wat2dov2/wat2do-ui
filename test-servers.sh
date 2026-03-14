#!/bin/bash

# Wat2Do Server Test Script
# Tests both backend and frontend servers

echo "🧪 Testing Wat2Do Servers..."
echo "================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test Backend
echo "1️⃣  Testing Backend (http://localhost:8000)..."
if curl -s -f -o /dev/null http://localhost:8000/health; then
    echo -e "${GREEN}✅ Backend is running${NC}"
    
    # Test events endpoint
    echo "   Testing /events/ endpoint..."
    EVENTS_RESPONSE=$(curl -s http://localhost:8000/events/)
    EVENT_COUNT=$(echo "$EVENTS_RESPONSE" | python3 -c "import sys, json; data = json.load(sys.stdin); print(len(data))" 2>/dev/null)
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Events API working - $EVENT_COUNT events returned${NC}"
        echo ""
        echo "   Events:"
        echo "$EVENTS_RESPONSE" | python3 -c "import sys, json; data = json.load(sys.stdin); [print(f'   - {e[\"title\"]} ({e[\"category\"]})') for e in data[:5]]" 2>/dev/null
    else
        echo -e "${RED}❌ Events API failed${NC}"
    fi
else
    echo -e "${RED}❌ Backend is NOT running${NC}"
    echo -e "${YELLOW}   Start it with: cd backend && . .venv/bin/activate && uvicorn main:app --reload --port 8000${NC}"
fi

echo ""
echo "2️⃣  Testing Frontend (http://localhost:5173)..."
if curl -s -f -o /dev/null http://localhost:5173/; then
    echo -e "${GREEN}✅ Frontend is running${NC}"
else
    echo -e "${RED}❌ Frontend is NOT running${NC}"
    echo -e "${YELLOW}   Start it with: cd frontend && npm run dev${NC}"
fi

echo ""
echo "================================"
echo "📊 Summary:"
echo ""

# Check both
BACKEND_OK=$(curl -s -f -o /dev/null http://localhost:8000/health && echo "yes" || echo "no")
FRONTEND_OK=$(curl -s -f -o /dev/null http://localhost:5173/ && echo "yes" || echo "no")

if [ "$BACKEND_OK" = "yes" ] && [ "$FRONTEND_OK" = "yes" ]; then
    echo -e "${GREEN}✅ All systems operational!${NC}"
    echo ""
    echo "🎯 Open the app: http://localhost:5173/"
    echo "📡 API endpoint: http://localhost:8000/events/"
    echo ""
    echo "Next steps:"
    echo "1. Open http://localhost:5173/ in your browser"
    echo "2. Open DevTools (F12) and check Console tab"
    echo "3. Verify events are displayed"
    echo "4. Check Network tab for successful API calls"
else
    echo -e "${RED}⚠️  Some services are not running${NC}"
    echo ""
    if [ "$BACKEND_OK" = "no" ]; then
        echo "Backend: Start with:"
        echo "  cd backend && . .venv/bin/activate && uvicorn main:app --reload --port 8000"
        echo ""
    fi
    if [ "$FRONTEND_OK" = "no" ]; then
        echo "Frontend: Start with:"
        echo "  cd frontend && npm run dev"
        echo ""
    fi
fi

echo ""
echo "📄 For detailed testing guide, see: FRONTEND_TESTING_SUMMARY.md"
echo "🧪 For API testing page, open: test-api.html"
