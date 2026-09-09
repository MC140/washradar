#!/usr/bin/env python3
"""Build WashRadar's zero-cost GTA address autocomplete index.

Input is Statistics Canada's Ontario Open Database of Addresses (ODA), a zipped CSV.
The generated files are static GitHub Pages assets, so normal address suggestions do
not consume Google API or Supabase database quota.

We deliberately omit unit/apartment duplication: for routing to a building, every
unit has the same useful origin. One building/civic address is enough for WashRadar.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path

GTA_CSD_NAMES = {
    "toronto", "mississauga", "brampton", "caledon", "oakville", "burlington",
    "milton", "halton hills", "vaughan", "richmond hill", "markham", "aurora",
    "newmarket", "east gwillimbury", "georgina", "king", "whitchurch stouffville",
    "pickering", "ajax", "whitby", "oshawa", "clarington", "uxbridge", "scugog", "brock",
}
SOURCE_NAME = "Statistics Canada Open Database of Addresses - Ontario"


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFD", value or "")
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def compact(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", normalize(value))


def get(row: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = row.get(key.upper())
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def parse_float(value: str) -> float | None:
    try:
        number = float(value)
        return number if number == number else None
    except (TypeError, ValueError):
        return None


def format_postal(value: str) -> str:
    raw = re.sub(r"[^A-Za-z0-9]", "", value or "").upper()
    return f"{raw[:3]} {raw[3:]}" if len(raw) == 6 else raw


def csv_members(zf: zipfile.ZipFile):
    for info in zf.infolist():
        if not info.is_dir() and info.filename.lower().endswith((".csv", ".txt")):
            yield info


def iter_rows(zip_path: Path):
    with zipfile.ZipFile(zip_path) as zf:
        members = list(csv_members(zf))
        if not members:
            raise RuntimeError("Address archive contains no CSV/TXT files.")
        found_data = False
        for info in members:
            with zf.open(info) as binary:
                text = io.TextIOWrapper(binary, encoding="utf-8-sig", errors="replace", newline="")
                sample = text.read(16384)
                text.seek(0)
                try:
                    dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
                except csv.Error:
                    dialect = csv.excel
                reader = csv.DictReader(text, dialect=dialect)
                if not reader.fieldnames:
                    continue
                reader.fieldnames = [str(field).strip().upper() for field in reader.fieldnames]
                fields = set(reader.fieldnames)
                # ODA releases use LATITUDE/LONGITUDE plus STREET_NO; aliases below
                # also make this resilient to small naming changes.
                has_coords = ("LATITUDE" in fields or "BG_LATITUDE" in fields) and ("LONGITUDE" in fields or "BG_LONGITUDE" in fields)
                has_address = any(field in fields for field in ("STREET_NO", "CIVIC_NO", "FULL_ADDR"))
                if not has_coords or not has_address:
                    continue
                found_data = True
                print(f"Processing {info.filename} with {len(fields)} columns", flush=True)
                for source in reader:
                    yield {str(k).upper(): ("" if v is None else str(v)) for k, v in source.items()}
        if not found_data:
            raise RuntimeError("No address CSV matching the expected ODA schema was found in the archive.")


def build(args: argparse.Namespace) -> int:
    source = Path(args.zip)
    out_dir = Path(args.output)
    chunks_dir = out_dir / "chunks"
    out_dir.mkdir(parents=True, exist_ok=True)
    chunks_dir.mkdir(parents=True, exist_ok=True)
    for old in chunks_dir.glob("*.json"):
        old.unlink()

    fallback_areas = []
    areas_path = out_dir / "areas.json"
    if areas_path.exists():
        try:
            fallback_areas = json.loads(areas_path.read_text(encoding="utf-8")).get("areas", [])
        except Exception:
            pass

    if not source.exists() or source.stat().st_size == 0:
        raise FileNotFoundError(f"Address archive not found: {source}")

    csv.field_size_limit(min(sys.maxsize, 2_147_483_647))
    chunks: dict[str, list[list]] = defaultdict(list)
    seen: set[str] = set()
    city_sums: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    fsa_sums: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    scanned = accepted = 0

    for row in iter_rows(source):
        scanned += 1
        if scanned % 250_000 == 0:
            print(f"Scanned {scanned:,}; GTA buildings accepted {accepted:,}", flush=True)

        csd_label = get(row, "CSD_NAME", "CSD_ENG_NAME")
        csd = normalize(csd_label)
        if csd not in GTA_CSD_NAMES:
            continue

        lat = parse_float(get(row, "LATITUDE", "BG_LATITUDE"))
        lng = parse_float(get(row, "LONGITUDE", "BG_LONGITUDE"))
        if lat is None or lng is None or not (42.8 <= lat <= 44.6 and -80.5 <= lng <= -78.0):
            continue

        civic = get(row, "STREET_NO", "CIVIC_NO")
        street = get(row, "STREET", "OFFICIAL_STREET_NAME", "MAIL_STREET_NAME")
        full_addr = get(row, "FULL_ADDR")
        if not civic and full_addr:
            match = re.match(r"^\s*([0-9]+[A-Za-z-]*)\s+(.+)$", full_addr)
            if match:
                civic, street = match.group(1), match.group(2)
        if not civic:
            continue
        if not street:
            street_name = get(row, "STR_NAME", "STREET_NAME")
            street_type = get(row, "STR_TYPE", "STREET_TYPE")
            street_dir = get(row, "STR_DIR", "STREET_DIRECTION")
            street = " ".join(part for part in (street_name, street_type, street_dir) if part)
        if not street:
            continue

        # ID_GROUP is the ODA grouping key. If absent, use the civic/street/CSD tuple.
        group_id = get(row, "ID_GROUP", "GROUP_INDEX", "GROUP_IDX")
        dedupe = group_id or f"{normalize(civic)}|{normalize(street)}|{csd}"
        if dedupe in seen:
            continue
        seen.add(dedupe)

        city = get(row, "CITY_PCS", "CITY", "MAIL_MUN_NAME") or csd_label
        postal = format_postal(get(row, "POSTAL_CODE", "MAIL_POSTAL_CODE"))
        address_text = f"{civic} {street}".strip()
        label = f"{address_text}, {city}, ON" + (f" {postal}" if postal else "")
        search_key = normalize(" ".join((address_text, city, postal)))
        compact_key = compact(search_key)
        if len(compact_key) < 3:
            continue
        chunks[compact_key[:3]].append([search_key, label, round(lat, 6), round(lng, 6)])
        accepted += 1

        city_key = normalize(csd_label or city)
        city_sums[city_key][0] += lat
        city_sums[city_key][1] += lng
        city_sums[city_key][2] += 1
        postal_raw = re.sub(r"[^A-Za-z0-9]", "", postal).upper()
        if len(postal_raw) >= 3:
            fsa = postal_raw[:3]
            fsa_sums[fsa][0] += lat
            fsa_sums[fsa][1] += lng
            fsa_sums[fsa][2] += 1

    if accepted == 0:
        raise RuntimeError("No GTA addresses were accepted from the Ontario ODA file.")

    total_bytes = largest_chunk = 0
    for key, rows in chunks.items():
        rows.sort(key=lambda item: (item[0], item[1]))
        payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
        (chunks_dir / f"{key}.json").write_text(payload, encoding="utf-8")
        size = len(payload.encode("utf-8"))
        total_bytes += size
        largest_chunk = max(largest_chunk, size)

    generated = {normalize(str(row[0])): row for row in fallback_areas if isinstance(row, list) and len(row) >= 5}
    for key, (lat_sum, lng_sum, count) in city_sums.items():
        if count:
            existing = generated.get(key)
            label = existing[1] if existing else f"{key.title()}, ON"
            generated[key] = [key, label, round(lat_sum / count, 6), round(lng_sum / count, 6), "city"]
    for fsa, (lat_sum, lng_sum, count) in fsa_sums.items():
        if count >= 2:
            key = normalize(fsa)
            generated[key] = [key, f"{fsa}, ON", round(lat_sum / count, 6), round(lng_sum / count, 6), "postal"]

    areas_path.write_text(json.dumps({
        "release": args.release,
        "source": SOURCE_NAME,
        "areas": sorted(generated.values(), key=lambda item: (item[4], item[0])),
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    manifest = {
        "available": True,
        "release": args.release,
        "source": SOURCE_NAME,
        "addressCount": accepted,
        "scannedRows": scanned,
        "chunkCount": len(chunks),
        "jsonBytes": total_bytes,
        "largestChunkBytes": largest_chunk,
        "unitAddressesOmitted": True,
        "strategy": "GTA-only, one result per building, 3-character address-prefix chunks",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2), flush=True)
    if total_bytes > args.max_bytes:
        raise RuntimeError(f"Generated index is {total_bytes / 1024 / 1024:.1f} MB, above the safety limit.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", required=True)
    parser.add_argument("--output", default="public/address-index")
    parser.add_argument("--release", default="ODA-ON-v1")
    parser.add_argument("--max-bytes", type=int, default=350 * 1024 * 1024)
    return build(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
