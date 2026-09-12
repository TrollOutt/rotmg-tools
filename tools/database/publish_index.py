from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXPORTER = ROOT / "tools/database/export_index.py"
DEFAULT_DB = ROOT / "data/Database/rotmg-tools.sqlite"

RUNTIME_ASSETS = (
    "web/assets/index/sheet.png",
    "web/assets/theory/sheet.png",
)


def compact(value):
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def pretty(value):
    return (
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)
        + "\n"
    ).encode("utf-8")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
    try:
        temporary.write_bytes(data)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def load_runtime_assets(db):
    connection = sqlite3.connect(db)
    try:
        rows = connection.execute(
            "SELECT asset_path,media_type,sha256,size_bytes,payload "
            "FROM runtime_assets ORDER BY asset_path"
        ).fetchall()
    finally:
        connection.close()

    assets = {}

    for path, media_type, stored_sha, stored_size, payload in rows:
        payload = bytes(payload)

        if media_type != "image/png":
            raise RuntimeError(
                f"unsupported runtime asset media type: {path}: {media_type}"
            )

        if len(payload) != stored_size:
            raise RuntimeError(f"runtime asset size mismatch: {path}")

        if sha256(payload) != stored_sha:
            raise RuntimeError(f"runtime asset SHA-256 mismatch: {path}")

        assets[path] = payload

    if set(assets) != set(RUNTIME_ASSETS):
        raise RuntimeError(
            "SQLite runtime asset set mismatch: " + repr(sorted(assets))
        )

    return assets


def publish(db, output_root, report_path=None, allow_production=False):
    db = Path(db).resolve()
    output_root = Path(output_root).resolve()

    if not db.is_file():
        raise RuntimeError(f"SQLite database not found: {db}")

    if output_root == ROOT and not allow_production:
        raise RuntimeError(
            "Refusing production publication without --allow-production"
        )

    with tempfile.TemporaryDirectory(prefix="rotmg-sqlite-publish-") as directory:
        temporary = Path(directory)
        exported = temporary / "index.json"
        export_report = temporary / "export-report.json"

        subprocess.run(
            [
                sys.executable,
                str(EXPORTER),
                "--db",
                str(db),
                "--output",
                str(exported),
                "--report",
                str(export_report),
            ],
            cwd=ROOT,
            check=True,
        )

        index = json.loads(exported.read_text(encoding="utf-8"))
        exporter_report = json.loads(
            export_report.read_text(encoding="utf-8")
        )

    if exporter_report.get("raw_index_document_dependency") is not False:
        raise RuntimeError("exporter depends on raw Index")

    if exporter_report.get("index_record_payload_dependency") is not False:
        raise RuntimeError("exporter depends on index_record payload_json")

    records = index.get("records")
    if not isinstance(records, list):
        raise RuntimeError("exported Index has no records list")

    search = {
        "built": index["built"],
        "from": index["from"],
        "tool": index["tool"],
        "records": [
            [
                record["id"],
                record.get("said") or record.get("name"),
                record["kind"],
                record.get("alias") or "",
                1 if record.get("hidden") else 0,
            ]
            for record in records
        ],
    }

    index_bytes = compact(index)
    search_bytes = compact(search)
    assets = load_runtime_assets(db)

    outputs = {
        "data/Index/index.json": index_bytes,
        "data/Index/search.json": search_bytes,
        "web/assets/index/index.json": index_bytes,
        **assets,
    }

    for relative, payload in outputs.items():
        atomic_write(output_root / relative, payload)

    report = {
        "status": "generated",
        "source": "sqlite",
        "database": str(db),
        "database_signature": exporter_report.get("database_signature"),
        "production_index_input_dependency": False,
        "raw_index_document_dependency": False,
        "index_record_payload_dependency": False,
        "records": len(records),
        "outputs": {
            relative: {
                "bytes": len(payload),
                "sha256": sha256(payload),
            }
            for relative, payload in outputs.items()
        },
    }

    if report_path is not None:
        atomic_write(Path(report_path), pretty(report))

    print(
        "SQLite runtime publication staged:"
        f" {len(records)} records,"
        f" {len(assets)} sheets"
    )

    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DEFAULT_DB)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--report")
    parser.add_argument("--allow-production", action="store_true")
    args = parser.parse_args()

    publish(
        args.db,
        args.output_root,
        args.report,
        args.allow_production,
    )


if __name__ == "__main__":
    main()
