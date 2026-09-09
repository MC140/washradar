#!/usr/bin/env python3
"""Build WashRadar's static GTA address autocomplete index from StatsCan NAR.

Statistics Canada's National Address Register stores coordinates in Ontario
Locations/Location_35*.csv files and civic-address attributes separately in
Addresses/Address_35*.csv files. This builder joins those datasets by LOC_GUID,
keeps only GTA municipalities, removes apartment/unit duplication, and writes
small static prefix chunks for GitHub Pages. Normal search therefore needs no
Google request and consumes no Supabase database storage.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sqlite3
import sys
import tempfile
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
SOURCE_NAME = "Statistics Canada National Address Register"
GTA_BBOX = (42.8, 44.6, -80.5, -78.0)  # broad safety filter around the GTA


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


def parse_float(value: str) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def open_reader(zf: zipfile.ZipFile, info: zipfile.ZipInfo):
    binary = zf.open(info)
    text = io.TextIOWrapper(binary, encoding="utf-8-sig", errors="replace", newline="")
    sample = text.read(16384)
    text.seek(0)
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(text, dialect=dialect)
    if reader.fieldnames:
        reader.fieldnames = [str(field).strip().upper() for field in reader.fieldnames]
    return binary, text, reader


def member_kind(name: str) -> str | None:
    base = Path(name).name.lower()
    if re.fullmatch(r"location_35(?:_part_\d+)?\.csv", base):
        return "location"
    if re.fullmatch(r"address_35(?:_part_\d+)?\.csv", base):
        return "address"
    return None


def matching_members(zf: zipfile.ZipFile, kind: str) -> list[zipfile.ZipInfo]:
    result = [info for info in zf.infolist() if not info.is_dir() and member_kind(info.filename) == kind]
    return sorted(result, key=lambda info: info.filename)


def configure_db(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        pragma journal_mode=OFF;
        pragma synchronous=OFF;
        pragma temp_store=FILE;
        pragma cache_size=-100000;
        create table locations (
            loc_guid text primary key,
            lat real not null,
            lng real not null
        ) without rowid;
        create table addresses (
            dedupe_key text primary key,
            loc_guid text not null,
            civic_no text not null,
            civic_suffix text,
            street_name text not null,
            street_type text,
            street_dir text,
            city text not null,
            csd_label text not null,
            postal_code text
        ) without rowid;
        create index addresses_loc_guid_idx on addresses(loc_guid);
        create table final_addresses (
            prefix text not null,
            search_key text not null,
            label text not null,
            lat real not null,
            lng real not null
        );
    """)


def load_locations(zf: zipfile.ZipFile, conn: sqlite3.Connection) -> tuple[int, int]:
    members = matching_members(zf, "location")
    if not members:
        raise RuntimeError("Ontario NAR location files (Locations/Location_35*.csv) were not found.")

    scanned = kept = 0
    batch: list[tuple[str, float, float]] = []
    for info in members:
        print(f"Reading coordinates: {info.filename}", flush=True)
        binary, text, reader = open_reader(zf, info)
        try:
            fields = set(reader.fieldnames or [])
            if "LOC_GUID" not in fields:
                print(f"Skipping {info.filename}: LOC_GUID missing", flush=True)
                continue
            for source in reader:
                scanned += 1
                row = {str(k).upper(): ("" if v is None else str(v)) for k, v in source.items()}
                loc_guid = get(row, "LOC_GUID", "LOCATION_GUID")
                lat = parse_float(get(row, "BG_LATITUDE", "BF_REPPOINT_LATITUDE", "LATITUDE", "REPPOINT_LATITUDE"))
                lng = parse_float(get(row, "BG_LONGITUDE", "BF_REPPOINT_LONGITUDE", "LONGITUDE", "REPPOINT_LONGITUDE"))
                if not loc_guid or lat is None or lng is None:
                    continue
                min_lat, max_lat, min_lng, max_lng = GTA_BBOX
                if not (min_lat <= lat <= max_lat and min_lng <= lng <= max_lng):
                    continue
                batch.append((loc_guid, lat, lng))
                if len(batch) >= 10000:
                    conn.executemany("insert or replace into locations values (?,?,?)", batch)
                    kept += len(batch)
                    batch.clear()
                if scanned % 500000 == 0:
                    print(f"Location rows scanned {scanned:,}; bbox candidates {kept + len(batch):,}", flush=True)
        finally:
            text.detach()
            binary.close()
    if batch:
        conn.executemany("insert or replace into locations values (?,?,?)", batch)
        kept += len(batch)
    conn.commit()
    actual = conn.execute("select count(*) from locations").fetchone()[0]
    print(f"Coordinate candidates retained: {actual:,}", flush=True)
    return scanned, actual


def load_addresses(zf: zipfile.ZipFile, conn: sqlite3.Connection) -> tuple[int, int]:
    members = matching_members(zf, "address")
    if not members:
        raise RuntimeError("Ontario NAR address files (Addresses/Address_35*.csv) were not found.")

    scanned = 0
    batch: list[tuple[str, str, str, str, str, str, str, str, str, str]] = []
    for info in members:
        print(f"Reading civic addresses: {info.filename}", flush=True)
        binary, text, reader = open_reader(zf, info)
        try:
            fields = set(reader.fieldnames or [])
            required = {"LOC_GUID", "CIVIC_NO"}
            if not required.issubset(fields):
                print(f"Skipping {info.filename}: required fields missing", flush=True)
                continue
            for source in reader:
                scanned += 1
                row = {str(k).upper(): ("" if v is None else str(v)) for k, v in source.items()}
                csd_label = get(row, "CSD_ENG_NAME", "CSD_NAME", "MAIL_MUN_NAME")
                if normalize(csd_label) not in GTA_CSD_NAMES:
                    continue
                loc_guid = get(row, "LOC_GUID", "LOCATION_GUID")
                civic_no = get(row, "CIVIC_NO")
                street_name = get(row, "OFFICIAL_STREET_NAME", "MAIL_STREET_NAME", "STREET_NAME")
                if not loc_guid or not civic_no or not street_name:
                    continue
                # Avoid carrying addresses whose coordinate location was outside the GTA bbox.
                if conn.execute("select 1 from locations where loc_guid=?", (loc_guid,)).fetchone() is None:
                    continue
                civic_suffix = get(row, "CIVIC_NO_SUFFIX")
                street_type = get(row, "OFFICIAL_STREET_TYPE", "MAIL_STREET_TYPE", "STREET_TYPE")
                street_dir = get(row, "OFFICIAL_STREET_DIR", "MAIL_STREET_DIR", "STREET_DIR")
                city = get(row, "MAIL_MUN_NAME") or csd_label
                postal = format_postal(get(row, "MAIL_POSTAL_CODE", "POSTAL_CODE"))
                # Apartment/unit numbers are intentionally excluded from the dedupe key.
                # They share the same useful navigation origin and would multiply the index size.
                dedupe_key = "|".join(normalize(v) for v in (
                    civic_no, civic_suffix, street_name, street_type, street_dir, csd_label
                ))
                batch.append((dedupe_key, loc_guid, civic_no, civic_suffix, street_name, street_type, street_dir, city, csd_label, postal))
                if len(batch) >= 5000:
                    conn.executemany("insert or ignore into addresses values (?,?,?,?,?,?,?,?,?,?)", batch)
                    batch.clear()
                if scanned % 500000 == 0:
                    count = conn.execute("select count(*) from addresses").fetchone()[0]
                    print(f"Address rows scanned {scanned:,}; GTA building addresses {count:,}", flush=True)
        finally:
            text.detach()
            binary.close()
    if batch:
        conn.executemany("insert or ignore into addresses values (?,?,?,?,?,?,?,?,?,?)", batch)
    conn.commit()
    actual = conn.execute("select count(*) from addresses").fetchone()[0]
    print(f"GTA civic building addresses retained: {actual:,}", flush=True)
    return scanned, actual


def build_final_rows(conn: sqlite3.Connection):
    city_sums: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    fsa_sums: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    batch: list[tuple[str, str, str, float, float]] = []
    accepted = 0
    query = """
        select a.civic_no, a.civic_suffix, a.street_name, a.street_type, a.street_dir,
               a.city, a.csd_label, a.postal_code, l.lat, l.lng
        from addresses a join locations l on l.loc_guid = a.loc_guid
    """
    for civic_no, civic_suffix, street_name, street_type, street_dir, city, csd_label, postal, lat, lng in conn.execute(query):
        street_bits = [civic_no]
        if civic_suffix:
            street_bits.append(civic_suffix)
        street_bits.append(street_name)
        if street_type:
            street_bits.append(street_type)
        if street_dir:
            street_bits.append(street_dir)
        address_text = " ".join(str(bit).strip() for bit in street_bits if str(bit).strip())
        label = f"{address_text}, {city}, ON" + (f" {postal}" if postal else "")
        search_key = normalize(" ".join((address_text, city, postal or "")))
        compact_key = compact(search_key)
        if len(compact_key) < 3:
            continue
        batch.append((compact_key[:3], search_key, label, round(float(lat), 6), round(float(lng), 6)))
        accepted += 1
        city_key = normalize(csd_label or city)
        city_sums[city_key][0] += float(lat)
        city_sums[city_key][1] += float(lng)
        city_sums[city_key][2] += 1
        postal_raw = re.sub(r"[^A-Za-z0-9]", "", postal or "").upper()
        if len(postal_raw) >= 3:
            fsa = postal_raw[:3]
            fsa_sums[fsa][0] += float(lat)
            fsa_sums[fsa][1] += float(lng)
            fsa_sums[fsa][2] += 1
        if len(batch) >= 10000:
            conn.executemany("insert into final_addresses values (?,?,?,?,?)", batch)
            batch.clear()
    if batch:
        conn.executemany("insert into final_addresses values (?,?,?,?,?)", batch)
    conn.execute("create index final_prefix_search_idx on final_addresses(prefix, search_key, label)")
    conn.commit()
    return accepted, city_sums, fsa_sums


def write_chunks(conn: sqlite3.Connection, chunks_dir: Path) -> tuple[int, int, int]:
    current_prefix = None
    handle = None
    first = True
    chunk_count = total_bytes = largest = current_bytes = 0
    try:
        for prefix, search_key, label, lat, lng in conn.execute(
            "select prefix, search_key, label, lat, lng from final_addresses order by prefix, search_key, label"
        ):
            if prefix != current_prefix:
                if handle is not None:
                    handle.write("]")
                    handle.close()
                    total_bytes += current_bytes + 1
                    largest = max(largest, current_bytes + 1)
                current_prefix = prefix
                handle = (chunks_dir / f"{prefix}.json").open("w", encoding="utf-8")
                handle.write("[")
                current_bytes = 1
                first = True
                chunk_count += 1
            payload = json.dumps([search_key, label, lat, lng], ensure_ascii=False, separators=(",", ":"))
            if not first:
                handle.write(",")
                current_bytes += 1
            handle.write(payload)
            current_bytes += len(payload.encode("utf-8"))
            first = False
        if handle is not None:
            handle.write("]")
            handle.close()
            handle = None
            total_bytes += current_bytes + 1
            largest = max(largest, current_bytes + 1)
    finally:
        if handle is not None:
            handle.close()
    return chunk_count, total_bytes, largest


def build(args: argparse.Namespace) -> int:
    source = Path(args.zip)
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

    if not source.exists() or source.stat().st_size == 0:
        raise FileNotFoundError(f"NAR archive not found: {source}")
    csv.field_size_limit(min(sys.maxsize, 2_147_483_647))

    with tempfile.TemporaryDirectory(prefix="washradar-nar-") as temp_dir:
        db_path = Path(temp_dir) / "nar.sqlite"
        conn = sqlite3.connect(db_path)
        try:
            configure_db(conn)
            with zipfile.ZipFile(source) as zf:
                names = [info.filename for info in zf.infolist()]
                location_members = matching_members(zf, "location")
                address_members = matching_members(zf, "address")
                print(f"NAR archive members: {len(names):,}; Ontario location files: {len(location_members)}; Ontario address files: {len(address_members)}", flush=True)
                location_scanned, location_kept = load_locations(zf, conn)
                address_scanned, address_kept = load_addresses(zf, conn)
            accepted, city_sums, fsa_sums = build_final_rows(conn)
            if accepted == 0:
                raise RuntimeError("NAR join produced zero GTA addresses. Inspect Ontario location/address schemas.")
            chunk_count, total_bytes, largest_chunk = write_chunks(conn, chunks_dir)
        finally:
            conn.close()

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
        "locationRowsScanned": location_scanned,
        "locationCandidates": location_kept,
        "addressRowsScanned": address_scanned,
        "dedupedGtaAddresses": address_kept,
        "addressCount": accepted,
        "chunkCount": chunk_count,
        "jsonBytes": total_bytes,
        "largestChunkBytes": largest_chunk,
        "unitAddressesOmitted": True,
        "strategy": "join Ontario NAR address/location files by LOC_GUID; GTA-only building-level 3-character prefix chunks",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2), flush=True)
    if total_bytes > args.max_bytes:
        raise RuntimeError(
            f"Generated index is {total_bytes / 1024 / 1024:.1f} MB, above the configured "
            f"{args.max_bytes / 1024 / 1024:.0f} MB safety limit."
        )
    if largest_chunk > args.max_chunk_bytes:
        raise RuntimeError(
            f"Largest autocomplete chunk is {largest_chunk / 1024 / 1024:.1f} MB, above the "
            f"{args.max_chunk_bytes / 1024 / 1024:.0f} MB per-request safety limit."
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", required=True, help="Path to Statistics Canada NAR release zip")
    parser.add_argument("--output", default="public/address-index")
    parser.add_argument("--release", default="202606")
    parser.add_argument("--max-bytes", type=int, default=350 * 1024 * 1024)
    parser.add_argument("--max-chunk-bytes", type=int, default=8 * 1024 * 1024)
    return build(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
