#!/usr/bin/env python3
"""Build a compact GTA address autocomplete index from Statistics Canada's ODA.

The deployed index lives on GitHub Pages, not in Supabase, so address lookups cost
WashRadar $0 per request and do not consume Supabase database space. Apartment/unit
rows are collapsed to one physical street address because routing only needs the
building location.
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
SOURCE_NAME = "Statistics Canada Open Database of Addresses (Ontario)"


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFD", value or "")
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = value.lower().replace("-", " ")
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


def parse_float(value: str) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def csv_reader(binary_stream: io.BufferedIOBase):
    text = io.TextIOWrapper(binary_stream, encoding="utf-8-sig", errors="replace", newline="")
    sample = text.read(8192)
    text.seek(0)
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(text, dialect=dialect)
    if reader.fieldnames:
        reader.fieldnames = [str(name).strip().upper() for name in reader.fieldnames]
    return reader, text


def iter_oda_rows(zf: zipfile.ZipFile):
    candidates = [item for item in zf.infolist() if not item.is_dir() and item.filename.lower().endswith(".csv")]
    if not candidates:
        raise RuntimeError("The Ontario ODA archive contained no CSV file.")
    for info in candidates:
        with zf.open(info) as raw:
            reader, text = csv_reader(raw)
            fields = set(reader.fieldnames or [])
            required = {"LATITUDE", "LONGITUDE"}
            if not required <= fields or not ({"STREET_NO", "FULL_ADDR"} & fields):
                try:
                    text.detach()
                except Exception:
                    pass
                continue
            print(f"Processing {info.filename} with {len(fields)} columns", flush=True)
            for source_row in reader:
                yield {str(k).upper(): ("" if v is None else str(v)) for k, v in source_row.items()}
            try:
                text.detach()
            except Exception:
                pass


def build(args: argparse.Namespace) -> int:
    archive = Path(args.zip)
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
            pass

    if not archive.exists() or archive.stat().st_size == 0:
        raise FileNotFoundError(f"ODA archive not found: {archive}")

    csv.field_size_limit(min(sys.maxsize, 2_147_483_647))
    chunks: dict[str, list[list]] = defaultdict(list)
    seen_addresses: set[str] = set()
    city_sums: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    fsa_sums: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    scanned = accepted = 0

    with zipfile.ZipFile(archive) as zf:
        for row in iter_oda_rows(zf):
            scanned += 1
            if scanned % 250_000 == 0:
                print(f"Scanned {scanned:,}; GTA building addresses {accepted:,}", flush=True)

            csd_raw = get(row, "CSDNAME", "CSD_NAME", "CSD_ENG_NAME")
            csd = normalize(csd_raw)
            if csd not in GTA_CSD_NAMES:
                continue

            lat = parse_float(get(row, "LATITUDE"))
            lng = parse_float(get(row, "LONGITUDE"))
            if lat is None or lng is None or not (42.8 <= lat <= 44.6 and -80.5 <= lng <= -78.0):
                continue

            civic = get(row, "STREET_NO", "CIVIC_NO")
            street = get(row, "STREET")
            if not street:
                name = get(row, "STR_NAME_PCS", "STR_NAME")
                stype = get(row, "STR_TYPE_PCS", "STR_TYPE")
                direction = get(row, "STR_DIR_PCS", "STR_DIR")
                street = " ".join(bit for bit in [name, stype, direction] if bit)
            full_addr = get(row, "FULL_ADDR")
            if not civic and full_addr:
                match = re.match(r"^\s*([0-9]+[A-Za-z-]*)\s+(.+)$", full_addr)
                if match:
                    civic, street = match.group(1), street or match.group(2)
            if not civic or not street:
                continue

            city = get(row, "CITY_PCS", "CITY") or csd_raw
            postal = format_postal(get(row, "POSTAL_CODE"))

            # ODA's group ID intentionally groups the same civic/street address. If it is
            # unavailable, build an equivalent key. Unit numbers are intentionally omitted.
            dedupe_key = get(row, "ID_GROUP") or "|".join([csd, normalize(civic), normalize(street)])
            if dedupe_key in seen_addresses:
                continue
            seen_addresses.add(dedupe_key)

            label = f"{civic} {street}, {city}, ON" + (f" {postal}" if postal else "")
            search_key = normalize(" ".join([civic, street, city, postal]))
            compacted = compact(search_key)
            if len(compacted) < 3:
                continue
            chunks[compacted[:3]].append([search_key, label, round(lat, 5), round(lng, 5)])
            accepted += 1

            city_key = normalize(csd_raw or city)
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
        raise RuntimeError("Ontario ODA was readable but no GTA addresses matched; source schema needs review.")

    total_bytes = max_chunk_bytes = 0
    for key, rows in chunks.items():
        rows.sort(key=lambda row: (row[0], row[1]))
        payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
        (chunks_dir / f"{key}.json").write_text(payload, encoding="utf-8")
        size = len(payload.encode("utf-8"))
        total_bytes += size
        max_chunk_bytes = max(max_chunk_bytes, size)

    fallback_by_key = {
        normalize(str(row[0])): row for row in fallback_areas
        if isinstance(row, list) and len(row) >= 5
    }
    generated_areas: dict[str, list] = dict(fallback_by_key)
    for city_key, (lat_sum, lng_sum, count) in city_sums.items():
        if count <= 0:
            continue
        fallback = fallback_by_key.get(city_key)
        label = fallback[1] if fallback else city_key.title() + ", ON"
        generated_areas[city_key] = [city_key, label, round(lat_sum / count, 5), round(lng_sum / count, 5), "city"]
    for fsa, (lat_sum, lng_sum, count) in fsa_sums.items():
        if count < 2:
            continue
        key = normalize(fsa)
        generated_areas[key] = [key, f"{fsa}, ON", round(lat_sum / count, 5), round(lng_sum / count, 5), "postal"]

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
        "strategy": "GTA-only, one row per civic/street building, static 3-character prefix chunks",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2), flush=True)
    if total_bytes > args.max_bytes:
        raise RuntimeError(
            f"Generated address index is {total_bytes / 1024 / 1024:.1f} MB; safety ceiling is "
            f"{args.max_bytes / 1024 / 1024:.0f} MB."
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", required=True, help="Path to Statistics Canada Ontario ODA ZIP")
    parser.add_argument("--output", default="public/address-index")
    parser.add_argument("--release", default="ODA-ON-v1")
    parser.add_argument("--max-bytes", type=int, default=350 * 1024 * 1024)
    return build(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
