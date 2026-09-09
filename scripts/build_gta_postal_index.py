#!/usr/bin/env python3
"""Build a tiny zero-cost GTA postal/FSA index from GeoNames Canada full postal data."""
import argparse
import csv
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path

# Generous GTA/Southern Ontario envelope. The FSA itself is used only as a search origin,
# so keeping nearby edge communities is safer than accidentally excluding GTA coverage.
MIN_LAT, MAX_LAT = 43.20, 44.25
MIN_LNG, MAX_LNG = -80.20, -78.35


def normalize_fsa(value: str) -> str:
    compact = re.sub(r"[^A-Za-z0-9]", "", value or "").upper()
    return compact[:3] if re.fullmatch(r"[A-Z]\d[A-Z].*", compact) else ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", required=True)
    parser.add_argument("--output", default="public/postal-index.json")
    args = parser.parse_args()

    totals = defaultdict(lambda: [0.0, 0.0, 0, set()])
    with zipfile.ZipFile(args.zip) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith((".txt", ".csv"))]
        if not names:
            raise RuntimeError("GeoNames Canada archive contains no text dataset")
        with archive.open(names[0]) as raw:
            lines = (line.decode("utf-8", errors="replace") for line in raw)
            reader = csv.reader(lines, delimiter="\t")
            for row in reader:
                if len(row) < 12 or row[0].upper() != "CA":
                    continue
                fsa = normalize_fsa(row[1])
                if not fsa:
                    continue
                admin1 = row[3].strip().lower()
                if admin1 != "ontario":
                    continue
                try:
                    lat = float(row[9])
                    lng = float(row[10])
                except ValueError:
                    continue
                if not (MIN_LAT <= lat <= MAX_LAT and MIN_LNG <= lng <= MAX_LNG):
                    continue
                entry = totals[fsa]
                entry[0] += lat
                entry[1] += lng
                entry[2] += 1
                if row[2].strip():
                    entry[3].add(row[2].strip())

    areas = []
    for fsa, (lat_sum, lng_sum, count, places) in sorted(totals.items()):
        if count <= 0:
            continue
        place = sorted(places)[0] if places else "Ontario"
        label = f"{fsa} · {place}, ON"
        areas.append([fsa.lower(), label, round(lat_sum / count, 5), round(lng_sum / count, 5), "postal"])

    keys = {row[0] for row in areas}
    if "m1x" not in keys:
        raise RuntimeError("Postal validation failed: M1X is missing from generated GTA FSA index")
    if len(areas) < 100:
        raise RuntimeError(f"Postal validation failed: only {len(areas)} GTA/Southern Ontario FSAs generated")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "GeoNames Canada full postal codes",
        "license": "CC BY 4.0",
        "coverage": "GTA and nearby Southern Ontario FSAs",
        "areas": areas,
    }
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"postalAreaCount": len(areas), "containsM1X": "m1x" in keys}, indent=2))


if __name__ == "__main__":
    main()
