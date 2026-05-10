#!/bin/bash
set -e
cd "$(dirname "$0")/../.."

DATE=$(date +%Y-%m-%d)
HARVEST_ROOT="lead-vault/acquisition/propstream"

TEXAS_DIRS=()
for dir in "$HARVEST_ROOT"/*-tx-all/2026-*/; do
  if [ -f "$dir/manifest.json" ]; then
    TEXAS_DIRS+=("--harvest" "$dir")
  fi
done

if [ ${#TEXAS_DIRS[@]} -eq 0 ]; then
  echo "No Texas harvests found in $HARVEST_ROOT"
  exit 1
fi

echo "Found ${#TEXAS_DIRS[@]} Texas harvest directories"
echo "Running pipeline with cell-phone gate + top 2000..."
echo ""

python3 -m lead_engine run "${TEXAS_DIRS[@]}" --top 2000 --label "texas-queue-${DATE}"

echo ""
echo "Queue ready at: lead-vault/pipeline/queue/texas-queue-${DATE}/_call-list.csv"
