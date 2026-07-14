#!/bin/bash
# Re-exports the 7 Texas counties whose skip traces weren't ready on first export.
# Harris County already has phone data — skip it.
# Run this after PropStream finishes processing skip trace orders (4-12 hours).
cd "$(dirname "$0")/.."

export PROPSTREAM_USERNAME="adilrchaudary@gmail.com"
export PROPSTREAM_PASSWORD="ArC_2007"

RUNTIME_PROFILE="$(pwd)/.runtime/profile"
REEXPORT_DIR="$HOME/Desktop/wholesaling-swarm/lead-vault/acquisition/propstream/_reexport-texas-all"
ACQUISITION_ROOT="$HOME/Desktop/wholesaling-swarm/lead-vault/acquisition/propstream"

COUNTIES_DATE1=(
  "dallas-county-tx|2026-05-06"
  "tarrant-county-tx|2026-05-06"
  "bexar-county-tx|2026-05-06"
  "travis-county-tx|2026-05-06"
  "collin-county-tx|2026-05-06"
  "denton-county-tx|2026-05-06"
)

COUNTIES_DATE2=(
  "fort-bend-county-tx|2026-05-07"
)

SIGNALS=("pre-foreclosure" "tax-delinquent" "probate")

LIST_NAMES=""
for entry in "${COUNTIES_DATE1[@]}" "${COUNTIES_DATE2[@]}"; do
  IFS='|' read -r slug date <<< "$entry"
  for signal in "${SIGNALS[@]}"; do
    name="swarm-${slug}-${signal}-all-${date}"
    if [ -z "$LIST_NAMES" ]; then
      LIST_NAMES="$name"
    else
      LIST_NAMES="${LIST_NAMES},${name}"
    fi
  done
done

pkill -f "chromium|chrome|Google Chrome" 2>/dev/null || true
sleep 3
rm -f "$RUNTIME_PROFILE/SingletonLock" 2>/dev/null || true

echo "========================================"
echo "  RE-EXPORTING 7 REMAINING TEXAS COUNTIES"
echo "  (Skip: Harris — already has phone data)"
echo "========================================"

npx tsx src/index.ts reexport "$LIST_NAMES" "$REEXPORT_DIR" 2>&1 | tee /tmp/reexport-texas-remaining.log

echo ""
echo "========================================"
echo "  DISTRIBUTING RE-EXPORTED CSVs"
echo "========================================"

TOTAL_DISTRIBUTED=0
for entry in "${COUNTIES_DATE1[@]}" "${COUNTIES_DATE2[@]}"; do
  IFS='|' read -r slug date <<< "$entry"
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

  MANIFEST="${HARVEST_DIR}/manifest.json"
  python3 -c "
import json, os, glob
harvest_dir = '${HARVEST_DIR}'
signals = {}
total = 0
for csv_file in glob.glob(os.path.join(harvest_dir, '*.csv')):
    sig = os.path.basename(csv_file).replace('.csv', '')
    with open(csv_file) as f:
        rows = len([l for l in f if l.strip()]) - 1
    signals[sig] = {'file': os.path.basename(csv_file), 'properties': rows}
    total += rows
m = {'signals': signals, 'totals': {'properties': total}}
json.dump(m, open(os.path.join(harvest_dir, 'manifest.json'), 'w'), indent=2)
print(f'  Manifest: ${slug}-all → {total} properties')
" 2>/dev/null
done

echo ""
echo "========================================"
echo "  RE-EXPORT COMPLETE"
echo "  Total distributed: $TOTAL_DISTRIBUTED rows"
echo "========================================"
echo ""
echo "Now running pipeline..."
echo ""

cd "$HOME/Desktop/wholesaling-swarm"
bash propstream-runner/scripts/pipeline-texas-full.sh
