#!/bin/bash
cd "$(dirname "$0")/.."

export PROPSTREAM_USERNAME="erdemkaradayi27@gmail.com"
export PROPSTREAM_PASSWORD="ArC_2007"

RUNTIME_PROFILE="$(pwd)/.runtime/profile"

COUNTIES=(
  "Dallas County, TX|dallas-county-tx"
  "Tarrant County, TX|tarrant-county-tx"
  "Bexar County, TX|bexar-county-tx"
  "Travis County, TX|travis-county-tx"
  "Collin County, TX|collin-county-tx"
  "Denton County, TX|denton-county-tx"
  "Fort Bend County, TX|fort-bend-county-tx"
)

MAX_PER_SIGNAL=210
TOTAL=0

for entry in "${COUNTIES[@]}"; do
  IFS='|' read -r county slug <<< "$entry"
  echo ""
  echo "========================================"
  echo "  HARVESTING (ALL): $county"
  echo "========================================"

  pkill -f "chromium|chrome|Google Chrome" 2>/dev/null || true
  sleep 5
  rm -f "$RUNTIME_PROFILE/SingletonLock" 2>/dev/null || true

  if npx tsx src/index.ts lead-harvest "$county" "$slug" $MAX_PER_SIGNAL pre_foreclosure,tax_delinquent,probate --no-vacant 2>&1 | tee /tmp/harvest-${slug}-all.log; then
    ROWS=$(grep "Saved.*rows to" /tmp/harvest-${slug}-all.log | grep -o "[0-9]* rows" | grep -o "[0-9]*" | paste -sd+ - | bc 2>/dev/null || echo "0")
    TOTAL=$((TOTAL + ROWS))
    echo "  → $county (all): $ROWS rows (running total: $TOTAL)"
  else
    echo "  ⚠ $county FAILED — skipping"
  fi
done

echo ""
echo "========================================"
echo "  TEXAS HARVEST (REMAINING) COMPLETE"
echo "  Total rows: $TOTAL"
echo "========================================"
