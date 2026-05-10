#!/bin/bash
cd "$(dirname "$0")/../.."

REEXPORT_DIR="lead-vault/acquisition/propstream/_reexport-ohio-all"
ACQUISITION_ROOT="lead-vault/acquisition/propstream"
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

TOTAL=0
COPIED=0

echo "========================================"
echo "  DISTRIBUTING RE-EXPORTED CSVs"
echo "========================================"

for slug in "${COUNTIES[@]}"; do
  HARVEST_DIR="${ACQUISITION_ROOT}/${slug}-all/${DATE}"
  mkdir -p "$HARVEST_DIR"

  for signal in "${SIGNALS[@]}"; do
    LIST_NAME="swarm-${slug}-${signal}-all-${DATE}"
    SRC="${REEXPORT_DIR}/${LIST_NAME}.csv"
    DST="${HARVEST_DIR}/${signal}.csv"

    if [ -f "$SRC" ]; then
      ROWS=$(tail -n +2 "$SRC" | grep -c . || echo "0")
      if [ "$ROWS" -gt 0 ]; then
        cp "$SRC" "$DST"
        echo "  ${slug} / ${signal}: ${ROWS} rows"
        TOTAL=$((TOTAL + ROWS))
        COPIED=$((COPIED + 1))
      fi
    fi
  done

  # Update or create manifest
  MANIFEST="${HARVEST_DIR}/manifest.json"
  python3 -c "
import json, os
manifest_path = '${MANIFEST}'
harvest_dir = '${HARVEST_DIR}'
slug = '${slug}'
signals = ['pre-foreclosure', 'tax-delinquent', 'probate']

if os.path.exists(manifest_path):
    m = json.load(open(manifest_path))
else:
    m = {
        'harvest_date': '${DATE}',
        'county': slug,
        'source': 'PropStream',
        'filters': [],
        'dnc_stripped': False,
        'signals': {},
        'totals': {'properties': 0}
    }

total = 0
for sig in signals:
    csv_path = os.path.join(harvest_dir, sig + '.csv')
    if os.path.exists(csv_path):
        with open(csv_path) as f:
            rows = len([l for l in f if l.strip()]) - 1
        m.setdefault('signals', {})[sig] = {'file': sig + '.csv', 'properties': rows}
        total += rows

m['totals']['properties'] = total
json.dump(m, open(manifest_path, 'w'), indent=2)
print(f'  Manifest: ${slug}-all → {total} properties')
" 2>/dev/null
done

echo ""
echo "========================================"
echo "  DISTRIBUTION COMPLETE"
echo "  Files copied: $COPIED"
echo "  Total rows: $TOTAL"
echo "========================================"
