#!/bin/bash
set -e
cd "$(dirname "$0")/../.."

DATE=$(date +%Y-%m-%d)
HARVEST_ROOT="lead-vault/acquisition/propstream"

OHIO_DIRS=()
for dir in "$HARVEST_ROOT"/*-oh/*/  "$HARVEST_ROOT"/*-oh-all/*/; do
  if [ -f "$dir/manifest.json" ]; then
    OHIO_DIRS+=("--harvest" "$dir")
  fi
done

if [ ${#OHIO_DIRS[@]} -eq 0 ]; then
  echo "No Ohio harvests found in $HARVEST_ROOT"
  exit 1
fi

echo "Found ${#OHIO_DIRS[@]} Ohio harvest directories"
echo "Running pipeline with cell-phone gate + top 2000..."
echo ""

python3 -m lead_engine run "${OHIO_DIRS[@]}" --top 2000 --label "ohio-queue-${DATE}"

echo ""
echo "Queue ready at: lead-vault/pipeline/queue/ohio-queue-${DATE}/_call-list.csv"
