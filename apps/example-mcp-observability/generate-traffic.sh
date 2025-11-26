#!/bin/bash

# Traffic Generator for MCP Observability Demo
# This script generates diverse traffic patterns to create interesting traces

set -e

BASE_URL="http://localhost:3000"
COLORS="\033[0;36m"
NC="\033[0m" # No Color
GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"

echo -e "${COLORS}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚦 Traffic Generator for MCP Observability Demo"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${NC}"

# Check if server is running
if ! curl -s "$BASE_URL/health" > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Server is not running at $BASE_URL${NC}"
    echo -e "${YELLOW}💡 Start the server first: pnpm start${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Server is running${NC}\n"

# Function to make a request and show result
make_request() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4

    echo -e "${COLORS}→ ${description}${NC}"

    if [ "$method" = "POST" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data" 2>&1)
    else
        response=$(curl -s -w "\n%{http_code}" "$BASE_URL$endpoint" 2>&1)
    fi

    http_code=$(echo "$response" | tail -n1)

    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo -e "${GREEN}  ✓ Status: $http_code${NC}"
    else
        echo -e "${RED}  ✗ Status: $http_code${NC}"
    fi

    sleep 0.5
}

echo "Generating diverse traffic patterns...\n"

# 1. Fast endpoints
echo -e "${YELLOW}📊 Fast Endpoints${NC}"
for i in {1..5}; do
    make_request "GET" "/api/users" "" "Request $i/5: List users"
done
echo ""

# 2. Variable speed endpoints
echo -e "${YELLOW}⏱️  Variable Speed Endpoints${NC}"
for i in {1..5}; do
    make_request "GET" "/api/users/user-$i/orders" "" "Request $i/5: Fetch orders (may be slow)"
done
echo ""

# 3. Complex nested traces
echo -e "${YELLOW}🔄 Complex Order Processing${NC}"
for i in {1..3}; do
    data="{\"userId\":\"user-$i\",\"items\":[{\"id\":\"item-1\",\"name\":\"Product $i\"}],\"total\":$((99 + i * 10)).99}"
    make_request "POST" "/api/orders" "$data" "Request $i/3: Create order (complex trace)"
done
echo ""

# 4. Slow endpoints
echo -e "${YELLOW}🐌 Slow Endpoints (>500ms)${NC}"
for i in {1..3}; do
    make_request "GET" "/api/analytics/report" "" "Request $i/3: Generate analytics report"
done
echo ""

# 5. Error endpoints
echo -e "${YELLOW}❌ Error Generation${NC}"
for i in {1..2}; do
    make_request "GET" "/api/error" "" "Request $i/2: Intentional error"
done
echo ""

# 6. Flaky endpoints
echo -e "${YELLOW}🎲 Flaky Endpoints (Random Success/Failure)${NC}"
for i in {1..5}; do
    make_request "GET" "/api/flaky" "" "Request $i/5: Flaky operation"
done
echo ""

# Summary
echo -e "${COLORS}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Traffic generation complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${NC}"

echo -e "${GREEN}📊 View traces in Jaeger:${NC}"
echo "   http://localhost:16686"
echo ""
echo -e "${GREEN}🤖 Query with Claude:${NC}"
echo '   "Show me all traces with errors from the last 5 minutes"'
echo '   "What are the slowest database queries?"'
echo '   "Find failed payment transactions"'
echo ""
