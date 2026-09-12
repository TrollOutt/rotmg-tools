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
REFERENCE_INDEX_SHEET = ROOT / "web/assets/index/sheet.png"
REFERENCE_THEORY_SHEET = ROOT / "web/assets/theory/sheet.png"

REPORT = ROOT / "data/Database/runtime-publication-report.json"


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def without_built(value):
    out = dict(value)
    out.pop("built", None)
    return out


def run_publisher(publisher, db, output, report, cwd):
    subprocess.run(
        [
            sys.executable,
            str(publisher),
            "--db",
            str(db),
            "--output-root",
            str(output),
            "--report",
            str(report),
        ],
        cwd=cwd,
        check=True,
    )


def main():
    prerequisites = (
        DB,
        PUBLISHER,
        EXPORTER,
        SIGNATURE,
        REFERENCE_INDEX,
        REFERENCE_SEARCH,
        REFERENCE_SERVED,
        REFERENCE_INDEX_SHEET,
        REFERENCE_THEORY_SHEET,
    )

    for path in prerequisites:
        assert path.exists(), f"missing prerequisite: {path}"

    protected = (
        REFERENCE_INDEX,
        REFERENCE_SEARCH,
        REFERENCE_SERVED,
        REFERENCE_INDEX_SHEET,
        REFERENCE_THEORY_SHEET,
    )

    before = {str(path): sha(path) for path in protected}

    reference_index = load(REFERENCE_INDEX)
    reference_search = load(REFERENCE_SEARCH)

    assert REFERENCE_INDEX.read_bytes() == REFERENCE_SERVED.read_bytes()

    with tempfile.TemporaryDirectory(prefix="rotmg-runtime-publish-") as directory:
        temp = Path(directory)

        stage = temp / "stage"
        stage_report = temp / "stage-report.json"

        run_publisher(PUBLISHER, DB, stage, stage_report, ROOT)

        candidate_index = load(stage / "data/Index/index.json")
        candidate_search = load(stage / "data/Index/search.json")

        assert without_built(candidate_index) == without_built(reference_index)
        assert without_built(candidate_search) == without_built(reference_search)

        assert (
            stage / "data/Index/index.json"
        ).read_bytes() == (
            stage / "web/assets/index/index.json"
        ).read_bytes()

        assert (
            stage / "web/assets/index/sheet.png"
        ).read_bytes() == REFERENCE_INDEX_SHEET.read_bytes()

        assert (
            stage / "web/assets/theory/sheet.png"
        ).read_bytes() == REFERENCE_THEORY_SHEET.read_bytes()

        # Strong proof: only SQLite plus the three publication scripts.
        sandbox = temp / "sandbox"
        tools = sandbox / "tools/database"
        tools.mkdir(parents=True)

        shutil.copy2(PUBLISHER, tools / "publish_index.py")
        shutil.copy2(EXPORTER, tools / "export_index.py")
        shutil.copy2(SIGNATURE, tools / "signature.py")

        assert not (sandbox / "data/Index/index.json").exists()
        assert not (sandbox / "client-data").exists()

        sandbox_output = sandbox / "published"
        sandbox_report = sandbox / "report.json"

        run_publisher(
            tools / "publish_index.py",
            DB,
            sandbox_output,
            sandbox_report,
            sandbox,
        )

        for relative in (
            "data/Index/index.json",
            "data/Index/search.json",
            "web/assets/index/index.json",
            "web/assets/index/sheet.png",
            "web/assets/theory/sheet.png",
        ):
            assert (
                sandbox_output / relative
            ).read_bytes() == (
                stage / relative
            ).read_bytes(), relative

    after = {str(path): sha(path) for path in protected}
    assert before == after, "runtime publication gate modified production"

    result = {
        "phase": "2G-A",
        "status": "ok",
        "records": len(reference_index["records"]),
        "production_files_untouched": True,
        "runtime_assets_from_sqlite": True,
        "sandbox_without_production_index": True,
        "sandbox_without_client_data": True,
        "index_semantic_parity_except_built": True,
        "search_semantic_parity_except_built": True,
        "index_sheet_exact": True,
        "theory_sheet_exact": True,
    }

    REPORT.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(
        "Phase 2G-A runtime publication gate: ok"
        f" | records={result['records']}"
        " | JSON=parity"
        " | sheets=exact"
        " | DB-only sandbox=ok"
        " | production=untouched"
    )


if __name__ == "__main__":
    main()
