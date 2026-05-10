#!/bin/bash
set -e
cd "$(dirname "$0")/.."

export PROPSTREAM_USERNAME="erdemkaradayi27@gmail.com"
export PROPSTREAM_PASSWORD="ArC_2007"

COUNTIES=(
  "Hamilton County, OH|hamilton-county-oh"
  "Summit County, OH|summit-county-oh"
  "Montgomery County, OH|montgomery-county-oh"
  "Lucas County, OH|lucas-county-oh"
  "Stark County, OH|stark-county-oh"
  "Butler County, OH|butler-county-oh"
  "Lorain County, OH|lorain-county-oh"
  "Mahoning County, OH|mahoning-county-oh"
  "Lake County, OH|lake-county-oh"
  "Trumbull County, OH|trumbull-county-oh"
  "Warren County, OH|warren-county-oh"
  "Clark County, OH|clark-county-oh"
  "Greene County, OH|greene-county-oh"
)

TOTAL=0

for entry in "${COUNTIES[@]}"; do
  IFS='|' read -r county slug <<< "$entry"
  echo ""
  echo "========================================"
  echo "  HARVESTING: $county"
  echo "========================================"

  pkill -f "chromium|chrome" 2>/dev/null || true
  sleep 3
  rm -f ~/.propstream-runner/chrome-profile/SingletonLock 2>/dev/null || true

  npx tsx src/index.ts lead-harvest "$county" "$slug" 2000 pre_foreclosure,tax_delinquent,probate 2>&1 | tee /tmp/harvest-${slug}.log

  ROWS=$(grep "Saved.*rows to" /tmp/harvest-${slug}.log | grep -o "[0-9]* rows" | grep -o "[0-9]*" | paste -sd+ - | bc || echo "0")
  TOTAL=$((TOTAL + ROWS))
  echo "  → $county: $ROWS rows (running total: $TOTAL)"
done

echo ""
echo "========================================"
echo "  OHIO HARVEST COMPLETE"
echo "  Total rows exported: $TOTAL"
echo "  Next: run the pipeline"
echo "    python3 -m lead_engine run --harvest lead-vault/acquisition/propstream/hamilton-county-oh/<date> --harvest ... --top 2000 --label ohio-full"
echo "========================================"
