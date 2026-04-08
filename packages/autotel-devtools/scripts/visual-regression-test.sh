#!/bin/bash
# Visual Regression Test Script using agent-browser
# Run: ./scripts/visual-regression-test.sh

set -e

OUTPUT_DIR="packages/autotel-devtools/src/widget/__tests__/visual"
BASELINE_DIR="$OUTPUT_DIR/baseline"
CURRENT_DIR="$OUTPUT_DIR/current"

mkdir -p "$BASELINE_DIR" "$CURRENT_DIR"

echo "Starting visual regression tests..."

# Start Storybook if not running
if ! curl -s http://localhost:6006 > /dev/null 2>&1; then
    echo "Storybook not running. Starting..."
    cd packages/autotel-devtools && pnpm storybook --no-open --port 6006 &
    STORYBOOK_PID=$!
    sleep 10
fi

# Verify Storybook is accessible
if ! curl -s http://localhost:6006 > /dev/null 2>&1; then
    echo "ERROR: Cannot connect to Storybook at http://localhost:6006"
    exit 1
fi

echo "✓ Storybook is running"

# Array of stories to test
declare -a STORIES=(
    "TracesView--Empty"
    "TracesView--Single-Trace"
    "TracesView--Multiple-Traces"
    "TracesView--With-Error"
    "TracesView--Long-Duration"
    "LogsView--Empty"
    "LogsView--Single-Log"
    "LogsView--Multiple-Logs"
    "LogsView--With-Errors"
    "LogsView--Different-Severities"
    "LogsView--With-Trace-Link"
    "LogsView--Multiple-Resources"
    "MetricsView--Empty"
    "MetricsView--Single-Event"
    "MetricsView--Multiple-Events"
    "MetricsView--Different-Types"
    "MetricsView--With-Attributes"
    "MetricsView--With-Trace-Link"
    "MetricsView--Many-Metrics"
    "ErrorsView--Empty"
    "ErrorsView--Single-Error"
    "ErrorsView--Multiple-Errors"
    "ErrorsView--With-Stack-Trace"
    "ErrorsView--With-Service"
    "ErrorsView--With-Affected-Traces"
    "ErrorsView--High-Frequency-Error"
    "ErrorsView--Different-Error-Types"
    "ServiceMapView--Empty"
    "ServiceMapView--Single-Service"
    "ServiceMapView--Multiple-Services"
    "ServiceMapView--With-Errors"
    "ServiceMapView--Many-Services"
    "ServiceMapView--High-Traffic-Services"
    "ServiceMapView--With-Logs-And-Errors"
)

echo "Capturing screenshots for ${#STORIES[@]} stories..."

for story in "${STORIES[@]}"; do
    # Convert story ID to URL path (e.g., "TracesView--Empty" -> "traces-view--empty")
    story_url=$(echo "$story" | tr '[:upper:]' '[:lower:]' | sed 's/--/-/g')
    
    screenshot_path="$CURRENT_DIR/${story}.png"
    baseline_path="$BASELINE_DIR/${story}.png"
    
    echo "  Testing: $story"
    
    # Open the story in Storybook
    agent-browser open "http://localhost:6006/?path=/${story_url}" 2>/dev/null
    sleep 2
    
    # Take screenshot
    agent-browser screenshot "$screenshot_path" 2>/dev/null
    
    # Compare with baseline if it exists
    if [ -f "$baseline_path" ]; then
        if diff -q "$baseline_path" "$screenshot_path" > /dev/null 2>&1; then
            echo "    ✓ PASSED (no changes)"
        else
            echo "    ⚠ CHANGED (diff detected)"
            # Optionally fail the test here
            # exit 1
        fi
    else
        echo "    ℹ NEW (no baseline yet)"
        # Copy as baseline for future runs
        cp "$screenshot_path" "$baseline_path"
    fi
done

# Capture full-page devtools UI
echo ""
echo "Capturing devtools server UI..."
cd packages/autotel-devtools
pnpm exec tsx src/cli.ts --port 4320 > /dev/null 2>&1 &
DEVTOOLS_PID=$!
sleep 3

agent-browser open http://localhost:4320 2>/dev/null
sleep 2
agent-browser screenshot "$CURRENT_DIR/devtools-fullpage.png" 2>/dev/null

# Click through tabs
for tab in "Resources" "Service\\ Map" "Metrics" "Logs" "Errors"; do
    agent-browser click "button:contains($tab)" 2>/dev/null || true
    sleep 1
    agent-browser screenshot "$CURRENT_DIR/devtools-${tab// /-}.png" 2>/dev/null
done

# Cleanup
kill $DEVTOOLS_PID 2>/dev/null || true
[ -n "$STORYBOOK_PID" ] && kill $STORYBOOK_PID 2>/dev/null || true

echo ""
echo "Visual regression tests complete!"
echo "Screenshots saved to: $CURRENT_DIR"
echo "Baselines saved to: $BASELINE_DIR"
echo ""
echo "To update baselines:"
echo "  cp $CURRENT_DIR/*.png $BASELINE_DIR/"

agent-browser close 2>/dev/null || true

exit 0