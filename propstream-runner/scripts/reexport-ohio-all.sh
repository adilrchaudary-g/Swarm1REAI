#!/bin/bash
cd "$(dirname "$0")/.."

export PROPSTREAM_USERNAME="erdemkaradayi27@gmail.com"
export PROPSTREAM_PASSWORD="ArC_2007"

RUNTIME_PROFILE="$(pwd)/.runtime/profile"
REEXPORT_DIR="$HOME/Desktop/wholesaling-swarm/lead-vault/acquisition/propstream/_reexport-ohio-all"
ACQUISITION_ROOT="$HOME/Desktop/wholesaling-swarm/lead-vault/acquisition/propstream"
DATE="2026-05-06"

COUNTIES=(
  "hamilton-county-oh"
  "summit-county-oh"
  "montgomery-county-oh"
  "lucas-county-oh"
  "stark-county-oh"
  "butler-county-oh"
  "lorain-county-oh"
  "mahoning-county-oh"
  "lake-county-oh"
  "trumbull-county-oh"
  "cuyahoga-county-oh"
  "franklin-county-oh"
  "warren-county-oh"
  "clark-county-oh"
  "greene-county-oh"
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

# Clean up Chrome locks
pkill -f "chromium|chrome|Google Chrome" 2>/dev/null || true
sleep 3
rm -f "$RUNTIME_PROFILE/SingletonLock" 2>/dev/null || true

echo "========================================"
echo "  RE-EXPORTING ALL OHIO LISTS"
echo "  Counties: ${#COUNTIES[@]}"
echo "  Signals: ${#SIGNALS[@]}"
echo "  Total lists: $(echo "$LIST_NAMES" | tr ',' '\n' | wc -l | tr -d ' ')"
echo "========================================"

# Run the reexport command
npx tsx src/index.ts reexport "$LIST_NAMES" "$REEXPORT_DIR" 2>&1 | tee /tmp/reexport-ohio-all.log

echo ""
echo "========================================"
echo "  DISTRIBUTING RE-EXPORTED CSVs"
echo "========================================"

TOTAL_DISTRIBUTED=0
for slug in "${COUNTIES[@]}"; do
  HARVEST_DIR="${ACQUISITION_ROOT}/${slug}-all/${DATE}"
  mkdir -p "$HARVEST_DIR"

  for signal in "${SIGNALS[@]}"; do
    LIST_NAME="swarm-${slug}-${signal}-all-${DATE}"
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

  # Update manifest
  MANIFEST="${HARVEST_DIR}/manifest.json"
  if [ -f "$MANIFEST" ]; then
    python3 -c "
import json, os
m = json.load(open('${MANIFEST}'))
total = 0
for sig_name, sig_info in m.get('signals', {}).items():
    csv_path = os.path.join('${HARVEST_DIR}', sig_info.get('file', ''))
    if os.path.exists(csv_path):
        with open(csv_path) as f:
            rows = len([l for l in f if l.strip()]) - 1
        sig_info['properties'] = rows
        total += rows
m['totals']['properties'] = total
json.dump(m, open('${MANIFEST}', 'w'), indent=2)
print(f'  Manifest updated: ${slug}-all → {total} properties')
" 2>/dev/null
  fi
done

echo ""
echo "========================================"
echo "  RE-EXPORT COMPLETE"
echo "  Total distributed: $TOTAL_DISTRIBUTED rows"
echo "========================================"
