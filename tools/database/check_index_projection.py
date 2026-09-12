"""Compare the SQLite-only candidate projection to the shipped Index."""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXPORTER = ROOT / "tools/database/export_index.py"
SIGNATURE = ROOT / "tools/database/signature.py"
DB = ROOT / "data/Database/rotmg-tools.sqlite"
REFERENCE = ROOT / "data/Index/index.json"
REPORT = ROOT / "data/Database/index-projection-report.json"


def dump(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def differences(expected, actual, path="", out=None):
    out = [] if out is None else out
    if type(expected) is not type(actual):
        out.append((path, expected, actual))
        return out
    if isinstance(expected, dict):
        for key in sorted(set(expected) | set(actual)):
            child = f"{path}.{key}" if path else key
            if key not in expected:
                out.append((child, "<missing>", actual[key]))
            elif key not in actual:
                out.append((child, expected[key], "<missing>"))
            else:
                differences(expected[key], actual[key], child, out)
    elif isinstance(expected, list):
        if len(expected) != len(actual):
            out.append((path + ".length", len(expected), len(actual)))
        for number, (want, got) in enumerate(zip(expected, actual)):
            differences(want, got, f"{path}[{number}]", out)
    elif expected != actual:
        out.append((path, expected, actual))
    return out


def records_by_id(records):
    out = {}
    duplicates = []
    for record in records:
        record_id = record.get("id")
        if record_id in out:
            duplicates.append(record_id)
        else:
            out[record_id] = record
    return out, duplicates


def equal_nonvolatile(reference, candidate):
    return not [
        entry for entry in differences(reference, candidate, "index")
        if entry[0] != "index.built"
    ]


def run_export(exporter, db, output, report, cwd):
    subprocess.run(
        [
            sys.executable,
            str(exporter),
            "--db",
            str(db),
            "--output",
            str(output),
            "--report",
            str(report),
        ],
        cwd=cwd,
        check=True,
    )


INSPECTION_VIEWS = (
    "v_index_record_labels",
    "v_entities",
    "v_browse_groups",
    "v_biome_members",
    "v_realmeye_pages",
)


def view_rows(db, view):
    con = __import__("sqlite3").connect(db)
    try:
        return sorted(con.execute(f"SELECT * FROM {view}").fetchall(), key=repr)
    finally:
        con.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB)
    parser.add_argument("--reference", default=REFERENCE)
    parser.add_argument("--report", default=REPORT)
    args = parser.parse_args()

    db = Path(args.db).resolve()
    reference_path = Path(args.reference).resolve()
    report_path = Path(args.report).resolve()
    reference = json.loads(reference_path.read_text(encoding="utf-8"))

    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        candidate_path = temp / "candidate.json"
        exporter_report_path = temp / "export-report.json"

        run_export(EXPORTER, db, candidate_path, exporter_report_path, ROOT)
        actual = json.loads(candidate_path.read_text(encoding="utf-8"))
        exporter_report = json.loads(
            exporter_report_path.read_text(encoding="utf-8")
        )
        baseline_inspection_views = {
            view: view_rows(db, view) for view in INSPECTION_VIEWS
        }

        full_diff = differences(reference, actual, "index")
        volatile_diff = [entry for entry in full_diff if entry[0] == "index.built"]
        diff = [entry for entry in full_diff if entry not in volatile_diff]

        reference_records, reference_duplicates = records_by_id(
            reference.get("records", [])
        )
        actual_records, actual_duplicates = records_by_id(actual.get("records", []))
        missing = sorted(set(reference_records) - set(actual_records))
        extra = sorted(set(actual_records) - set(reference_records))
        different_records = sorted(
            record_id
            for record_id in set(reference_records) & set(actual_records)
            if reference_records[record_id] != actual_records[record_id]
        )

        # Strong filesystem-independence test: execute copies of exporter/signature
        # under a temporary repo root that contains no data/Index/index.json.
        sandbox_root = temp / "sandbox"
        sandbox_tools = sandbox_root / "tools/database"
        sandbox_tools.mkdir(parents=True)
        shutil.copy2(EXPORTER, sandbox_tools / "export_index.py")
        shutil.copy2(SIGNATURE, sandbox_tools / "signature.py")
        sandbox_candidate = temp / "sandbox-candidate.json"
        sandbox_report = temp / "sandbox-report.json"
        run_export(
            sandbox_tools / "export_index.py",
            db,
            sandbox_candidate,
            sandbox_report,
            sandbox_root,
        )
        sandbox_actual = json.loads(
            sandbox_candidate.read_text(encoding="utf-8")
        )
        independence_ok = equal_nonvolatile(reference, sandbox_actual) and equal_nonvolatile(sandbox_actual, actual)

        # Phase 2B: the candidate must not require the Index raw document even
        # when it remains present for migration audit in the source database.
        without_raw_db = temp / "without-raw-index.sqlite"
        shutil.copy2(db, without_raw_db)
        con = __import__("sqlite3").connect(without_raw_db)
        con.execute("DELETE FROM raw_documents WHERE relative_path='data/Index/index.json'")
        con.commit(); con.close()
        without_raw_candidate = temp / "without-raw-index.json"
        run_export(EXPORTER, without_raw_db, without_raw_candidate, temp / "without-raw-report.json", ROOT)
        without_raw_ok = equal_nonvolatile(reference, json.loads(without_raw_candidate.read_text(encoding="utf-8")))
        con = __import__("sqlite3").connect(without_raw_db)
        con.execute("UPDATE source_records SET payload_json='{}' WHERE record_type='index_record'")
        con.commit(); con.close()
        without_payload_candidate = temp / "without-index-record-payloads.json"
        run_export(EXPORTER, without_raw_db, without_payload_candidate, temp / "without-payload-report.json", ROOT)
        without_payload_ok = equal_nonvolatile(reference, json.loads(without_payload_candidate.read_text(encoding="utf-8")))
        inspection_view_results = {
            view: view_rows(without_raw_db, view) == baseline_inspection_views[view]
            for view in INSPECTION_VIEWS
        }
        inspection_views_payload_free = all(inspection_view_results.values())
        raw_document_free = (
            exporter_report.get("raw_index_document_dependency") is False
            and not exporter_report.get("raw_fallbacks")
        )
        payload_free = exporter_report.get("index_record_payload_dependency") is False

        top_level_keys_equal = set(reference) == set(actual)
        special = {"built", "files", "records", "catalogues", "views"}
        top_level_metadata_equal = all(
            reference.get(key) == actual.get(key)
            for key in set(reference) | set(actual)
            if key not in special
        )
        field_presence_order_equal = all(
            list(reference_records[key]) == list(actual_records[key])
            for key in set(reference_records) & set(actual_records)
        )
        from_equal = all(
            reference_records[key].get("from") == actual_records[key].get("from")
            for key in set(reference_records) & set(actual_records)
        )

        report = {
            **exporter_report,
            "reference": str(reference_path.relative_to(ROOT))
            if reference_path.is_relative_to(ROOT)
            else str(reference_path),
            "candidate_bytes": candidate_path.stat().st_size,
            "semantic_parity": len(diff) == 0,
            "generation_metadata": {
                "reference_built": reference.get("built"),
                "candidate_built": actual.get("built"),
                "differences": len(volatile_diff),
                "only_nonsemantic_difference": bool(volatile_diff) and not diff,
            },
            "top_level": {
                "keys_equal": top_level_keys_equal,
                "metadata_equal": top_level_metadata_equal,
                "different": 0 if top_level_keys_equal and top_level_metadata_equal else 1,
            },
            "records": {
                "candidate": len(actual.get("records", [])),
                "reference": len(reference.get("records", [])),
                "duplicate_candidate_ids": actual_duplicates,
                "duplicate_reference_ids": reference_duplicates,
                "missing": len(missing),
                "extra": len(extra),
                "different": len(different_records),
                "different_fields": len(diff),
                "missing_ids": missing[:20],
                "extra_ids": extra[:20],
                "different_ids": different_records[:20],
            },
            "files": {"equal": reference.get("files") == actual.get("files")},
            "record_order": {
                "equal": [record.get("id") for record in reference.get("records", [])]
                == [record.get("id") for record in actual.get("records", [])]
            },
            "field_presence_and_order": {"equal": field_presence_order_equal},
            "from": {"equal": from_equal},
            "also": {
                "equal": all(
                    reference_records[key].get("also")
                    == actual_records[key].get("also")
                    for key in set(reference_records) & set(actual_records)
                )
            },
            "folds": {
                "equal": all(
                    reference_records[key].get("folds")
                    == actual_records[key].get("folds")
                    for key in set(reference_records) & set(actual_records)
                )
            },
            "folded_targets": {
                "equal": all(
                    reference_records[key].get("folded")
                    == actual_records[key].get("folded")
                    for key in set(reference_records) & set(actual_records)
                )
            },
            "catalogues": {
                "equal": reference.get("catalogues") == actual.get("catalogues"),
                "different": 0
                if reference.get("catalogues") == actual.get("catalogues")
                else 1,
            },
            "views": {
                "equal": reference.get("views") == actual.get("views"),
                "different": 0
                if reference.get("views") == actual.get("views")
                else 1,
            },
            "exporter_independence": {
                "temporary_root_without_index_json": independence_ok,
                "export_without_raw_index_document": without_raw_ok,
                "export_without_index_record_payloads": without_payload_ok,
                "inspection_views_without_index_record_payloads": inspection_views_payload_free,
                "inspection_view_results": inspection_view_results,
            },
            "status": "ok"
            if not diff
            and not reference_duplicates
            and not actual_duplicates
            and independence_ok
            and without_raw_ok
            and without_payload_ok
            and inspection_views_payload_free
            and raw_document_free
            and payload_free
            and field_presence_order_equal
            and from_equal
            else "different",
        }

        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(dump(report), encoding="utf-8")

        if diff or reference_duplicates or actual_duplicates or not independence_ok or not without_raw_ok or not without_payload_ok or not inspection_views_payload_free or not raw_document_free or not payload_free or not field_presence_order_equal or not from_equal:
            for path, want, got in diff[:20]:
                print(f"{path}: expected={want!r} actual={got!r}")
            if reference_duplicates:
                print(
                    f"duplicate reference record IDs: {reference_duplicates[:20]}",
                    file=sys.stderr,
                )
            if actual_duplicates:
                print(
                    f"duplicate candidate record IDs: {actual_duplicates[:20]}",
                    file=sys.stderr,
                )
            if not independence_ok:
                print("exporter filesystem-independence test failed", file=sys.stderr)
            if not without_raw_ok:
                print("exporter still depends on raw Index document", file=sys.stderr)
            if not without_payload_ok:
                print("exporter still depends on index_record payload_json", file=sys.stderr)
            if not inspection_views_payload_free:
                failed_views = [view for view, ok in inspection_view_results.items() if not ok]
                print(f"inspection views still depend on index_record payload_json: {failed_views}", file=sys.stderr)
            if not raw_document_free:
                print("exporter reports a raw Index fallback", file=sys.stderr)
            if not payload_free:
                print("exporter reports an index_record payload dependency", file=sys.stderr)
            if not field_presence_order_equal:
                print("record field presence/order mismatch", file=sys.stderr)
            if not from_equal:
                print("primary declaration mismatch", file=sys.stderr)
            print(f"{len(diff)} projection differences", file=sys.stderr)
            raise SystemExit(1)

    print(
        "Index projection semantic parity: ok | "
        f"records={report['records']['candidate']} | "
        "files=ok | record-order=ok | fields=ok | from=ok | also=ok | folds=ok | folded=ok | "
        "catalogues=ok | views=ok | raw-index=not-required | "
        "index-record-payload=not-required | inspection-views=payload-free | independence=ok"
    )


if __name__ == "__main__":
    main()
