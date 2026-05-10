import csv
import sys
import os

def strip_dnc(filepath):
    name = os.path.basename(filepath)
    rows = []
    cleared = 0
    kept = 0
    with open(filepath, 'r') as fh:
        reader = csv.reader(fh)
        header = next(reader)
        rows.append(header)
        for row in reader:
            for slot in range(5):
                phone_idx = 7 + slot * 3
                type_idx = 8 + slot * 3
                dnc_idx = 9 + slot * 3
                if dnc_idx < len(row) and row[dnc_idx].strip():
                    if row[phone_idx].strip():
                        cleared += 1
                    row[phone_idx] = ''
                    row[type_idx] = ''
                    row[dnc_idx] = ''
                elif phone_idx < len(row) and row[phone_idx].strip():
                    kept += 1
            rows.append(row)

    with open(filepath, 'w', newline='') as fh:
        writer = csv.writer(fh)
        writer.writerows(rows)

    print(f"  {name}: removed {cleared} DNC numbers, kept {kept} clean numbers")

for path in sys.argv[1:]:
    strip_dnc(path)
