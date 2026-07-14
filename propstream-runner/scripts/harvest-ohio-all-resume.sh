#!/bin/bash
cd "$(dirname "$0")/.."

export PROPSTREAM_USERNAME="adilrchaudary@gmail.com"
export PROPSTREAM_PASSWORD="ArC_2007"

RUNTIME_PROFILE="$(pwd)/.runtime/profile"

COUNTIES=(
  "Montgomery County, OH|montgomery-county-oh"
  "Lucas County, OH|lucas-county-oh"
  "Stark County, OH|stark-county-oh"
  "Butler County, OH|butler-county-oh"
  "Lorain County, OH|lorain-county-oh"
  "Mahoning County, OH|mahoning-county-oh"
  "Lake County, OH|lake-county-oh"
  "Trumbull County, OH|trumbull-county-oh"
  "Cuyahoga County, OH|cuyahoga-county-oh"
  "Franklin County, OH|franklin-county-oh"
  "Warren County, OH|warren-county-oh"
  "Clark County, OH|clark-county-oh"
  "Greene County, OH|greene-county-oh"
)

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
  rm -f ~/.propstream-runner/chrome-profile/SingletonLock 2>/dev/null || true

  if npx tsx src/index.ts lead-harvest "$county" "$slug" 2000 pre_foreclosure,tax_delinquent,probate --no-vacant 2>&1 | tee /tmp/harvest-${slug}-all.log; then
    ROWS=$(grep "Saved.*rows to" /tmp/harvest-${slug}-all.log | grep -o "[0-9]* rows" | grep -o "[0-9]*" | paste -sd+ - | bc || echo "0")
    TOTAL=$((TOTAL + ROWS))
    echo "  → $county (all): $ROWS rows (running total: $TOTAL)"
  else
    echo "  ⚠ $county FAILED — skipping"
  fi
done

echo ""
echo "========================================"
echo "  OHIO HARVEST RESUME COMPLETE"
echo "  Total new rows: $TOTAL"
echo "========================================"
