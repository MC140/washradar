#!/usr/bin/env python3
"""Build a compact, static GTA address autocomplete index from Statistics Canada's NAR.

The output is intended for GitHub Pages, not Supabase. We intentionally keep one
record per physical building (LOC_GUID) and omit apartment/unit identifiers because
all units in a building share the same routing origin. This keeps the index small
while still letting a user find their building address without any paid geocoding.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path

GTA_CSD_NAMES = {
    "toronto",
    "mississauga",
    "brampton",
    "caledon",
    "oakville",
    "burlington",
    "milton",
    "halton hills",
    "vaughan",
    "richmond hill",
    "markham",
    "aurora",
    "newmarket",
    "east gwillimbury",
    "georgina",
    "king",
    "whitchurch stouffville",
    "pickering",
    "ajax",
    "whitby",
    "oshawa",
    "clarington",
    "uxbridge",
    "scugog",
    "brock",
}

SOURCE_NAME = "Statistics Canada National Address Register"


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFD", value or "")
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def compact(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", normalize(value))


def format_postal(value: str) -> str:
    raw = re.sub(r"[^A-Za-z0-9]", "", value or "").upper()
    return f"{raw[:3]} {raw[3:]}" if len(raw) == 6 else raw


def get(row: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = row.get(key.upper())
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def canonical_city(value: str) -> str:
    return normalize(value).replace("-", " ")


def parse_float(value: str) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def detect_csv_stream(binary_stream: io.BufferedIOBase, name: str):
    text = io.TextIOWrapper(binary_stream, encoding="utf-8-sig", errors="replace", newline="")
    sample = text.read(8192)
    text.seek(0)
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(text, dialect=dialect)
    if not reader.fieldnames:
        return None, text
    reader.fieldnames = [str(name).strip().upper() for name in reader.fieldnames]
    return reader, text


def candidate_members(zf: zipfile.ZipFile):
    for info in zf.infolist():
        if info.is_dir():
            continue
        lower = info.filename.lower()
        if lower.endswith((".csv", ".txt", ".zip")):
            yield info


def iter_rows_from_zip(zf: zipfile.ZipFile, depth: int = 0):
    for info in candidate_members(zf):
        lower = info.filename.lower()
        if lower.endswith(".zip") and depth < 2:
            with zf.open(info) as nested_file:
                payload = nested_file.read()
            try:
                with zipfile.ZipFile(io.BytesIO(payload)) as nested:
                    yield from iter_rows_from_zip(nested, depth + 1)
            except zipfile.BadZipFile:
                continue
            continue

        with zf.open(info) as raw:
            reader, text = detect_csv_stream(raw, info.filename)
            if reader is None:
                text.detach()
                continue
            fields = set(reader.fieldnames or [])
            # Ignore documentation/lookup CSVs. A NAR address file must contain these.
            if not ({"CIVIC_NO", "BG_LATITUDE", "BG_LONGITUDE"} <= fields):
                try:
                    text.detach()
                except Exception:
                    pass
                continue
            print(f"Processing {info.filename} ...", flush=True)
            for source_row in reader:
                row = {str(k).upper(): ("" if v is None else str(v)) for k, v in source_row.items()}
                yield row
            try:
                text.detach()
            except Exception:
                pass


def build(args: argparse.Namespace) -> int:
    zip_path = Path(args.zip)
    out_dir = Path(args.output)
    chunks_dir = out_dir / "chunks"
    out_dir.mkdir(parents=True, exist_ok=True)
    chunks_dir.mkdir(parents=True, exist_ok=True)

    for old in chunks_dir.glob("*.json"):
        old.unlink()

    fallback_areas: list[list] = []
    areas_path = out_dir / "areas.json"
    if areas_path.exists():
        try:
            fallback_areas = json.loads(areas_path.read_text(encoding="utf-8")).get("areas", [])
        except Exception:
            fallback_areas = []

    if not zip_path.exists() or zip_path.stat().st_size == 0:
        raise FileNotFoundError(f"NAR archive not found: {zip_path}")

    csv.field_size_limit(min(sys.maxsize, 2_147_483_647))

    chunks: dict[str, list[list]] = defaultdict(list)
    seen_locations: set[str] = set()
    city_sums: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    fsa_sums: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    accepted = 0
    scanned = 0

    with zipfile.ZipFile(zip_path) as zf:
        for row in iter_rows_from_zip(zf):
            scanned += 1
            if scanned % 500_000 == 0:
                print(f"Scanned {scanned:,}; accepted {accepted:,}", flush=True)

            prov = get(row, "PROV_CODE")
            mail_prov = get(row, "MAIL_PROV_ABVN")
            if prov not in {"35", "35.0"} and mail_prov.upper() != "ON":
                continue

            csd = canonical_city(get(row, "CSD_ENG_NAME"))
            if csd not in GTA_CSD_NAMES:
                continue

            lat = parse_float(get(row, "BG_LATITUDE", "LATITUDE"))
            lng = parse_float(get(row, "BG_LONGITUDE", "LONGITUDE"))
            if lat is None or lng is None or not (42.8 <= lat <= 44.6 and -80.5 <= lng <= -78.0):
                continue

            civic_no = get(row, "CIVIC_NO")
            street_name = get(row, "OFFICIAL_STREET_NAME", "MAIL_STREET_NAME")
            if not civic_no or not street_name:
                continue

            location_id = get(row, "LOC_GUID", "LOCATIONID", "LOCATION_ID")
            dedupe_key = location_id or "|".join([
                civic_no,
                get(row, "CIVIC_NO_SUFFIX"),
                street_name,
                get(row, "OFFICIAL_STREET_TYPE", "MAIL_STREET_TYPE"),
                get(row, "OFFICIAL_STREET_DIR", "MAIL_STREET_DIR"),
                csd,
            ])
            if dedupe_key in seen_locations:
                continue
            seen_locations.add(dedupe_key)

            suffix = get(row, "CIVIC_NO_SUFFIX")
            street_type = get(row, "OFFICIAL_STREET_TYPE", "MAIL_STREET_TYPE")
            street_dir = get(row, "OFFICIAL_STREET_DIR", "MAIL_STREET_DIR")
            mail_city = get(row, "MAIL_MUN_NAME") or get(row, "CSD_ENG_NAME")
            postal = format_postal(get(row, "MAIL_POSTAL_CODE", "POSTAL_CODE"))

            street_bits = [civic_no]
            if suffix:
                street_bits.append(suffix)
            street_bits.append(street_name)
            if street_type:
                street_bits.append(street_type)
            if street_dir:
                street_bits.append(street_dir)
            street = " ".join(bit for bit in street_bits if bit).strip()
            label = f"{street}, {mail_city}, ON" + (f" {postal}" if postal else "")
            search_key = normalize(" ".join([street, mail_city, postal]))
            key_compact = compact(search_key)
            if len(key_compact) < 3:
                continue
            chunk_key = key_compact[:3]
            chunks[chunk_key].append([search_key, label, round(lat, 6), round(lng, 6)])
            accepted += 1

            city_label = (get(row, "CSD_ENG_NAME") or mail_city).strip()
            city_key = normalize(city_label)
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
        raise RuntimeError("No GTA addresses were found in the NAR archive; inspect source format/headers.")

    total_bytes = 0
    max_chunk_bytes = 0
    for key, rows in chunks.items():
        rows.sort(key=lambda row: (row[0], row[1]))
        path = chunks_dir / f"{key}.json"
        payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
        path.write_text(payload, encoding="utf-8")
        size = len(payload.encode("utf-8"))
        total_bytes += size
        max_chunk_bytes = max(max_chunk_bytes, size)

    fallback_by_key = {normalize(str(row[0])): row for row in fallback_areas if isinstance(row, list) and len(row) >= 5}
    generated_areas: dict[str, list] = dict(fallback_by_key)

    for city_key, (lat_sum, lng_sum, count) in city_sums.items():
        if count <= 0:
            continue
        label = next((row[1] for key, row in fallback_by_key.items() if key == city_key), None)
        if not label:
            label = city_key.title() + ", ON"
        generated_areas[city_key] = [city_key, label, round(lat_sum / count, 6), round(lng_sum / count, 6), "city"]

    for fsa, (lat_sum, lng_sum, count) in fsa_sums.items():
        if count < 2:
            continue
        key = normalize(fsa)
        generated_areas[key] = [key, f"{fsa}, ON", round(lat_sum / count, 6), round(lng_sum / count, 6), "postal"]

    areas_payload = {
        "release": args.release,
        "source": SOURCE_NAME,
        "areas": sorted(generated_areas.values(), key=lambda row: (row[4], row[0])),
    }
    areas_path.write_text(json.dumps(areas_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    manifest = {
        "available": True,
        "release": args.release,
        "source": SOURCE_NAME,
        "addressCount": accepted,
        "chunkCount": len(chunks),
        "jsonBytes": total_bytes,
        "largestChunkBytes": max_chunk_bytes,
        "unitAddressesOmitted": True,
        "strategy": "one record per physical building; 3-character civic-address prefix chunks",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(json.dumps(manifest, indent=2), flush=True)
    if total_bytes > args.max_bytes:
        raise RuntimeError(
            f"Generated index is {total_bytes / 1024 / 1024:.1f} MB, above configured "
            f"{args.max_bytes / 1024 / 1024:.0f} MB safety limit."
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", required=True, help="Path to downloaded Statistics Canada NAR zip")
    parser.add_argument("--output", default="public/address-index")
    parser.add_argument("--release", default="202606")
    parser.add_argument("--max-bytes", type=int, default=450 * 1024 * 1024)
    args = parser.parse_args()
    return build(args)


if __name__ == "__main__":
    raise SystemExit(main())
