#!/bin/bash
set -e
cd "$(dirname "$0")/.."

export PROPSTREAM_USERNAME="adilrchaudary@gmail.com"
export PROPSTREAM_PASSWORD="ArC_2007"

COUNTIES=(
  "Dallas County, TX|dallas-county-tx"
  "Bexar County, TX|bexar-county-tx"
  "Travis County, TX|travis-county-tx"
  "Collin County, TX|collin-county-tx"
  "Fort Bend County, TX|fort-bend-county-tx"
  "Denton County, TX|denton-county-tx"
  "Montgomery County, TX|montgomery-county-tx"
)

TOTAL=0

for entry in "${COUNTIES[@]}"; do
  IFS='|' read -r county slug <<< "$entry"
  echo ""
  echo "========================================"
  echo "  HARVESTING: $county"
  echo "========================================"

  # Kill any stale Chrome
  pkill -f "chromium|chrome" 2>/dev/null || true
  sleep 3
  rm -f ~/.propstream-runner/chrome-profile/SingletonLock 2>/dev/null || true

  npx tsx src/index.ts lead-harvest "$county" "$slug" 1000 pre_foreclosure 2>&1 | tee /tmp/harvest-${slug}.log

  ROWS=$(grep "Saved.*rows to" /tmp/harvest-${slug}.log | grep -o "[0-9]* rows" | head -1 | grep -o "[0-9]*" || echo "0")
  TOTAL=$((TOTAL + ROWS))
  echo "  → $county: $ROWS rows (running total: $TOTAL)"
done

echo ""
echo "========================================"
echo "  TEXAS HARVEST COMPLETE"
echo "  Total rows exported: $TOTAL"
echo "========================================"
