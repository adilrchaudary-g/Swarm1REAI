#!/bin/bash
cd "$(dirname "$0")/.."

export PROPSTREAM_USERNAME="erdemkaradayi27@gmail.com"
export PROPSTREAM_PASSWORD="ArC_2007"

RUNTIME_PROFILE="$(pwd)/.runtime/profile"
REEXPORT_DIR="$HOME/Desktop/wholesaling-swarm/lead-vault/acquisition/propstream/_reexport-texas-all"
ACQUISITION_ROOT="$HOME/Desktop/wholesaling-swarm/lead-vault/acquisition/propstream"
DATE="2026-05-06"
DATE2="2026-05-07"

COUNTIES=(
  "harris-county-tx"
  "dallas-county-tx"
  "tarrant-county-tx"
  "bexar-county-tx"
  "travis-county-tx"
  "collin-county-tx"
  "denton-county-tx"
)

COUNTIES_DATE2=(
  "fort-bend-county-tx"
)

SIGNALS=("pre-foreclosure" "tax-delinquent" "probate")

# Build comma-separated list of all list names
LIST_NAMES=""
for slug in "${COUNTIES[@]}"; do
  for signal in "${SIGNALS[@]}"; do
    name="swarm-${slug}-${signal}-all-${DATE}"
    if [ -z "$LIST_NAMES" ]; then
      LIST_NAMES="$name"
    else
      LIST_NAMES="${LIST_NAMES},${name}"
    fi
  done
done
for slug in "${COUNTIES_DATE2[@]}"; do
  for signal in "${SIGNALS[@]}"; do
    name="swarm-${slug}-${signal}-all-${DATE2}"
    LIST_NAMES="${LIST_NAMES},${name}"
  done
done

# Clean up Chrome locks
pkill -f "chromium|chrome|Google Chrome" 2>/dev/null || true
sleep 3
rm -f "$RUNTIME_PROFILE/SingletonLock" 2>/dev/null || true

echo "========================================"
echo "  RE-EXPORTING ALL TEXAS LISTS"
echo "  Counties: ${#COUNTIES[@]}"
echo "  Signals: ${#SIGNALS[@]}"
echo "  Total lists: $(echo "$LIST_NAMES" | tr ',' '\n' | wc -l | tr -d ' ')"
echo "========================================"

# Run the reexport command
npx tsx src/index.ts reexport "$LIST_NAMES" "$REEXPORT_DIR" 2>&1 | tee /tmp/reexport-texas-all.log

echo ""
echo "========================================"
echo "  DISTRIBUTING RE-EXPORTED CSVs"
echo "========================================"

TOTAL_DISTRIBUTED=0

distribute_county() {
  local slug="$1"
  local date="$2"
  HARVEST_DIR="${ACQUISITION_ROOT}/${slug}-all/${date}"
  mkdir -p "$HARVEST_DIR"

  for signal in "${SIGNALS[@]}"; do
    LIST_NAME="swarm-${slug}-${signal}-all-${date}"
    SRC="${REEXPORT_DIR}/${LIST_NAME}.csv"
    DST="${HARVEST_DIR}/${signal}.csv"

    if [ -f "$SRC" ]; then
      ROWS=$(wc -l < "$SRC" | tr -d ' ')
      ROWS=$((ROWS - 1))
      if [ "$ROWS" -gt 0 ]; then
        cp "$SRC" "$DST"
        echo "  ${slug} / ${signal}: ${ROWS} rows"
        TOTAL_DISTRIBUTED=$((TOTAL_DISTRIBUTED + ROWS))
      fi
    fi
  done

  # Create/update manifest
  MANIFEST="${HARVEST_DIR}/manifest.json"
  python3 -c "
import json, os, glob
harvest_dir = '${HARVEST_DIR}'
signals = {}
total = 0
for csv in glob.glob(os.path.join(harvest_dir, '*.csv')):
    sig = os.path.basename(csv).replace('.csv', '')
    with open(csv) as f:
        rows = len([l for l in f if l.strip()]) - 1
    signals[sig] = {'file': os.path.basename(csv), 'properties': rows}
    total += rows
m = {'signals': signals, 'totals': {'properties': total}}
json.dump(m, open(os.path.join(harvest_dir, 'manifest.json'), 'w'), indent=2)
print(f'  Manifest: ${slug}-all → {total} properties')
" 2>/dev/null
}

for slug in "${COUNTIES[@]}"; do
  distribute_county "$slug" "$DATE"
done
for slug in "${COUNTIES_DATE2[@]}"; do
  distribute_county "$slug" "$DATE2"
done

echo ""
echo "========================================"
echo "  TEXAS RE-EXPORT COMPLETE"
echo "  Total distributed: $TOTAL_DISTRIBUTED rows"
echo "========================================"
echo ""
echo "Next: run pipeline"
echo "  cd ~/Desktop/wholesaling-swarm"
echo "  python3 -m lead_engine run --harvest lead-vault/acquisition/propstream/*-tx-all/2026-*/ --top 2000 --label texas-call-list"
