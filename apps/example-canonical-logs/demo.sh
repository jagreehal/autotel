#!/bin/bash
#
# Wide Event Builder Demo
#
# This script steps through a checkout flow, showing how context
# accumulates into a single wide event. Run the server first:
#   pnpm start:server
#
# Then run this script:
#   ./demo.sh
#

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
REQUEST_ID="req_$(date +%s)"

echo ""
echo "========================================================================"
echo "  Wide Event Builder Demo - Autotel Canonical Log Lines"
echo "========================================================================"
echo ""
echo "Request ID: $REQUEST_ID"
echo ""
echo "Watch the server console for the canonical log line at the end!"
echo ""

# Step 1: Request Received
echo "────────────────────────────────────────────────────────────────────────"
echo "Step 1 of 6: Request Received"
echo "────────────────────────────────────────────────────────────────────────"
echo ""
curl -s -X POST "$BASE_URL/checkout/start" \
  -H "Content-Type: application/json" \
  -d "{\"request_id\": \"$REQUEST_ID\"}" | jq .
echo ""
sleep 1

# Step 2: User Authenticated
echo "────────────────────────────────────────────────────────────────────────"
echo "Step 2 of 6: User Authenticated"
echo "────────────────────────────────────────────────────────────────────────"
echo ""
curl -s -X POST "$BASE_URL/checkout/auth" \
  -H "Content-Type: application/json" \
  -d "{\"request_id\": \"$REQUEST_ID\", \"user_id\": \"user_456\"}" | jq .
echo ""
sleep 1

# Step 3: Cart Loaded
echo "────────────────────────────────────────────────────────────────────────"
echo "Step 3 of 6: Cart Loaded"
echo "────────────────────────────────────────────────────────────────────────"
echo ""
curl -s -X POST "$BASE_URL/checkout/cart" \
  -H "Content-Type: application/json" \
  -d "{\"request_id\": \"$REQUEST_ID\", \"cart_id\": \"cart_xyz\"}" | jq .
echo ""
sleep 1

# Step 4: Payment Processing
echo "────────────────────────────────────────────────────────────────────────"
echo "Step 4 of 6: Payment Processing"
echo "────────────────────────────────────────────────────────────────────────"
echo ""
curl -s -X POST "$BASE_URL/checkout/payment" \
  -H "Content-Type: application/json" \
  -d "{\"request_id\": \"$REQUEST_ID\"}" | jq .
echo ""
sleep 1

# Step 5-6: Complete (Success or Failure)
echo "────────────────────────────────────────────────────────────────────────"
echo "Step 5-6 of 6: Complete + Emit Canonical Log"
echo "────────────────────────────────────────────────────────────────────────"
echo ""

# Check if --error flag was passed
if [[ "$1" == "--error" ]]; then
  echo "(Simulating payment failure)"
  echo ""
  curl -s -X POST "$BASE_URL/checkout/complete" \
    -H "Content-Type: application/json" \
    -d "{\"request_id\": \"$REQUEST_ID\", \"simulate_error\": true}" | jq .
else
  curl -s -X POST "$BASE_URL/checkout/complete" \
    -H "Content-Type: application/json" \
    -d "{\"request_id\": \"$REQUEST_ID\"}" | jq .
fi

echo ""
echo "========================================================================"
echo "  Done! Check the server console for the canonical log line."
echo ""
echo "  The wide event contains ALL context from every step:"
echo "  - Request: id, timestamp, method, path, service"
echo "  - User: id, subscription, account_age_days, lifetime_value_cents"
echo "  - Cart: id, item_count, total_cents, coupon_applied"
echo "  - Payment: method, provider, latency_ms, attempt"
echo "  - Result: duration_ms, status_code, outcome"
echo ""
echo "  One event. Complete picture. Trivially queryable."
echo "========================================================================"
echo ""
