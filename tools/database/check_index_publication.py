from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data/Database/rotmg-tools.sqlite"
PUBLISHER = ROOT / "tools/database/publish_index.py"
EXPORTER = ROOT / "tools/database/export_index.py"
SIGNATURE = ROOT / "tools/database/signature.py"

REFERENCE_INDEX = ROOT / "data/Index/index.json"
REFERENCE_SEARCH = ROOT / "data/Index/search.json"
REFERENCE_SERVED = ROOT / "web/assets/index/index.json"

REPORT = ROOT / "data/Database/index-publication-report.json"


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def without_built(value):
    value = dict(value)
    value.pop("built", None)
    return value


def run_publisher(publisher, db, output_root, report, cwd):
    subprocess.run(
        [
            sys.executable,
            str(publisher),
            "--db",
            str(db),
            "--output-root",
            str(output_root),
            "--report",
            str(report),
        ],
        cwd=cwd,
        check=True,
    )


def main():
    for path in (
        DB,
        PUBLISHER,
        EXPORTER,
        SIGNATURE,
        REFERENCE_INDEX,
        REFERENCE_SEARCH,
        REFERENCE_SERVED,
    ):
        assert path.exists(), f"missing Phase 2E prerequisite: {path}"

    # The current production files are inputs only to the parity checker.
    # Publication itself must never open or overwrite them.
    protected = (
        REFERENCE_INDEX,
        REFERENCE_SEARCH,
        REFERENCE_SERVED,
    )
    before = {str(path): sha(path) for path in protected}

    reference_index = load(REFERENCE_INDEX)
    reference_search = load(REFERENCE_SEARCH)

    # build-index copies production index.json byte-for-byte to the served tree.
    assert REFERENCE_INDEX.read_bytes() == REFERENCE_SERVED.read_bytes(), (
        "current production served Index is not an exact copy of data/Index/index.json"
    )

    with tempfile.TemporaryDirectory(prefix="rotmg-phase2e-") as directory:
        temp = Path(directory)

        # --------------------------------------------------------------
        # Normal staging publication.
        # --------------------------------------------------------------
        stage = temp / "stage"
        stage_report = temp / "stage-report.json"

        run_publisher(PUBLISHER, DB, stage, stage_report, ROOT)

        candidate_index_path = stage / "data/Index/index.json"
        candidate_search_path = stage / "data/Index/search.json"
        candidate_served_path = stage / "web/assets/index/index.json"

        candidate_index = load(candidate_index_path)
        candidate_search = load(candidate_search_path)
        publisher_report = load(stage_report)

        # Phase 2D canonicalized `built`; it is the only intentional delta
        # from the historical shipped Index.
        assert without_built(candidate_index) == without_built(reference_index), (
            "staged SQLite Index differs from production outside root field 'built'"
        )

        assert without_built(candidate_search) == without_built(reference_search), (
            "staged SQLite search.json differs from production outside 'built'"
        )

        assert candidate_index["built"] == candidate_search["built"]
        assert candidate_index["from"] == candidate_search["from"]
        assert candidate_index["tool"] == candidate_search["tool"]

        # Exactly what the browser will fetch.
        assert candidate_index_path.read_bytes() == candidate_served_path.read_bytes()

        # Runtime publication must stay compact rather than exposing the
        # pretty-printed migration/export representation.
        candidate_bytes = candidate_index_path.read_bytes()
        assert candidate_bytes.endswith(b"\n")
        assert candidate_bytes.count(b"\n") == 1, (
            "published Index is not compact single-line JSON"
        )

        reference_bytes = REFERENCE_INDEX.stat().st_size
        assert len(candidate_bytes) <= reference_bytes * 1.10 + 1024, (
            f"published Index unexpectedly large: "
            f"{len(candidate_bytes)} vs historical {reference_bytes}"
        )

        assert publisher_report["production_index_input_dependency"] is False
        assert publisher_report["raw_index_document_dependency"] is False
        assert publisher_report["index_record_payload_dependency"] is False

        # --------------------------------------------------------------
        # Strong independence proof.
        #
        # Run publisher + exporter + signature from a fake repository that
        # contains no data/Index directory at all. The only external input is
        # the SQLite file passed explicitly with --db.
        # --------------------------------------------------------------
        sandbox = temp / "sandbox"
        sandbox_tools = sandbox / "tools/database"
        sandbox_tools.mkdir(parents=True)

        shutil.copy2(PUBLISHER, sandbox_tools / "publish_index.py")
        shutil.copy2(EXPORTER, sandbox_tools / "export_index.py")
        shutil.copy2(SIGNATURE, sandbox_tools / "signature.py")

        assert not (sandbox / "data/Index/index.json").exists()

        sandbox_output = sandbox / "published"
        sandbox_report = sandbox / "publication-report.json"

        run_publisher(
            sandbox_tools / "publish_index.py",
            DB,
            sandbox_output,
            sandbox_report,
            sandbox,
        )

        assert (
            sandbox_output / "data/Index/index.json"
        ).read_bytes() == candidate_index_path.read_bytes()

        assert (
            sandbox_output / "data/Index/search.json"
        ).read_bytes() == candidate_search_path.read_bytes()

        assert (
            sandbox_output / "web/assets/index/index.json"
        ).read_bytes() == candidate_served_path.read_bytes()

    # Nothing in production may have changed during the rehearsal.
    after = {str(path): sha(path) for path in protected}
    assert before == after, "Phase 2E rehearsal modified a production runtime file"

    report = {
        "phase": "2E",
        "status": "ok",
        "source": "sqlite",
        "production_files_untouched": True,
        "production_index_input_dependency": False,
        "raw_index_document_dependency": False,
        "index_record_payload_dependency": False,
        "sandbox_without_production_index": True,
        "index": {
            "semantic_parity_except_built": True,
            "records": len(candidate_index["records"]),
            "reference_built": reference_index.get("built"),
            "sqlite_built": candidate_index.get("built"),
            "reference_bytes": REFERENCE_INDEX.stat().st_size,
            "published_bytes": len(candidate_bytes),
        },
        "search": {
            "semantic_parity_except_built": True,
            "records": len(candidate_search["records"]),
        },
        "served_copy_exact": True,
    }

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(
        "Phase 2E publication rehearsal: ok"
        f" | records={report['index']['records']}"
        " | index=semantic-parity-except-built"
        " | search=semantic-parity-except-built"
        " | served-copy=exact"
        " | production=untouched"
        " | sandbox-no-index=ok"
        f" | bytes={report['index']['published_bytes']}"
    )


if __name__ == "__main__":
    main()
