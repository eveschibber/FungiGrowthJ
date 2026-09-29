#!/usr/bin/env python3
"""Merge FungiGrowthJ result CSV files into unified datasets.

This script is intentionally independent from the biological-analysis notebook.
It performs the data-management step only:

1. Find all *FungiGrowthJ_results.csv files in a ZIP archive or directory.
2. Concatenate all result rows into one raw CSV.
3. Resolve multiple revisions of the same image using the same revision logic
   used by the FungiGrowthJ biological-analysis notebook.
4. Write a resolved CSV containing only the highest revision for each image.

The script does not perform biological filtering, aggregation, statistics,
trajectory fitting, PCA, clustering, or interpretation.

Usage examples
--------------

ZIP input::

    python scripts/merge_results.py results.zip

Directory input::

    python scripts/merge_results.py results/

Optional output directory::

    python scripts/merge_results.py results.zip --output-dir merged_results

Outputs
-------

    FungiGrowthJ_results_unified_raw.csv
        All rows from all result CSV files, before revision resolution.

    FungiGrowthJ_results_unified_resolved.csv
        Rows from the highest available revision for each unique image identity.
"""

from __future__ import annotations

import argparse
import io
import re
import sys
import zipfile
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd


RESULT_TOKEN = "fungigrowthj_results"
OUTPUT_RAW = "FungiGrowthJ_results_unified_raw.csv"
OUTPUT_RESOLVED = "FungiGrowthJ_results_unified_resolved.csv"

DATE_CANDIDATES = ["date", "date_raw", "observation_date"]
STRAIN_CANDIDATES = ["strain_id", "strain", "isolate_id"]
REPLICATE_CANDIDATES = ["replicate_id", "replicate", "rep"]
IMAGE_CANDIDATES = ["image_file", "image", "filename"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Merge FungiGrowthJ result CSV files and resolve revisions."
    )
    parser.add_argument(
        "input_path",
        type=Path,
        help="FungiGrowthJ results ZIP archive or directory containing result CSV files.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("merged_results"),
        help="Directory where the two unified CSV files will be written (default: merged_results).",
    )
    return parser.parse_args()


def first_existing(columns: Iterable[str], candidates: Iterable[str]) -> str | None:
    available = set(columns)
    for candidate in candidates:
        if candidate in available:
            return candidate
    return None


def path_revision(path: str | Path) -> int:
    """Return revision number encoded in a path; legacy paths return 0."""
    match = re.search(r"revision[_-]?(\d+)", str(path), re.IGNORECASE)
    return int(match.group(1)) if match else 0


def read_csv_bytes(data: bytes, source_name: str) -> pd.DataFrame:
    """Read a CSV from bytes with a small encoding fallback."""
    try:
        df = pd.read_csv(io.BytesIO(data), encoding="utf-8-sig")
    except UnicodeDecodeError:
        df = pd.read_csv(io.BytesIO(data), encoding="latin-1")

    df["source_result_file"] = source_name
    return df


def read_csv_file(path: Path, source_name: str) -> pd.DataFrame:
    try:
        df = pd.read_csv(path, encoding="utf-8-sig")
    except UnicodeDecodeError:
        df = pd.read_csv(path, encoding="latin-1")

    df["source_result_file"] = source_name
    return df


def result_files_in_directory(root: Path) -> list[Path]:
    return sorted(
        p
        for p in root.rglob("*.csv")
        if p.is_file() and RESULT_TOKEN in p.name.lower()
    )


def result_files_in_zip(z: zipfile.ZipFile) -> list[str]:
    return sorted(
        name
        for name in z.namelist()
        if not name.endswith("/")
        and name.lower().endswith(".csv")
        and RESULT_TOKEN in Path(name).name.lower()
    )


def load_result_frames(input_path: Path) -> tuple[list[pd.DataFrame], list[str], list[str]]:
    """Load all matching result CSVs.

    Returns
    -------
    frames
        Successfully read dataframes.
    files_found
        Matching input file names.
    skipped
        Matching files that could not be read.
    """
    frames: list[pd.DataFrame] = []
    skipped: list[str] = []

    if input_path.is_file() and input_path.suffix.lower() == ".zip":
        with zipfile.ZipFile(input_path, "r") as z:
            names = result_files_in_zip(z)
            for name in names:
                try:
                    frames.append(read_csv_bytes(z.read(name), name))
                except Exception as exc:  # noqa: BLE001 - report and continue
                    skipped.append(f"{name}: {exc}")
        return frames, names, skipped

    if input_path.is_dir():
        files = result_files_in_directory(input_path)
        for path in files:
            try:
                source_name = str(path.relative_to(input_path)).replace("\\", "/")
                frames.append(read_csv_file(path, source_name))
            except Exception as exc:  # noqa: BLE001 - report and continue
                skipped.append(f"{path}: {exc}")
        return frames, [str(p) for p in files], skipped

    if input_path.is_file() and input_path.suffix.lower() == ".csv":
        if RESULT_TOKEN not in input_path.name.lower():
            raise ValueError(
                f"The CSV filename does not contain '{RESULT_TOKEN}': {input_path.name}"
            )
        try:
            frame = read_csv_file(input_path, input_path.name)
            return [frame], [input_path.name], []
        except Exception as exc:  # noqa: BLE001
            return [], [input_path.name], [f"{input_path.name}: {exc}"]

    raise FileNotFoundError(
        f"Input must be a ZIP archive, directory, or FungiGrowthJ result CSV: {input_path}"
    )


def resolve_revisions(raw: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, object]]:
    """Resolve the highest revision for each image identity.

    The revision key and rank intentionally mirror the biological-analysis
    notebook:

        image key = strain + replicate + date + image file
        revision rank = max(analysis_revision, revision encoded in source path)

    A legacy result outside a revision directory has path revision 0.
    """
    date_col = first_existing(raw.columns, DATE_CANDIDATES)
    strain_col = first_existing(raw.columns, STRAIN_CANDIDATES)
    replicate_col = first_existing(raw.columns, REPLICATE_CANDIDATES)
    image_col = first_existing(raw.columns, IMAGE_CANDIDATES)

    if date_col is None:
        raise ValueError(
            "No recognizable date column was found. Expected one of: "
            + ", ".join(DATE_CANDIDATES)
        )
    if strain_col is None or replicate_col is None:
        raise ValueError(
            "Could not identify strain and replicate columns. Expected strain from "
            + ", ".join(STRAIN_CANDIDATES)
            + " and replicate from "
            + ", ".join(REPLICATE_CANDIDATES)
        )

    df = raw.copy()

    df["_fgj_strain_id"] = df[strain_col].astype(str)
    df["_fgj_replicate_id"] = df[replicate_col].astype(str)
    df["_fgj_date"] = pd.to_datetime(df[date_col], errors="coerce").dt.normalize()

    if df["_fgj_date"].isna().all():
        raise ValueError(f"Dates in column '{date_col}' could not be parsed.")

    if image_col is not None:
        df["_fgj_image_file"] = df[image_col].astype(str)
    else:
        df["_fgj_image_file"] = df["source_result_file"].map(lambda x: Path(x).name)

    if "analysis_revision" in df.columns:
        analysis_rev = pd.to_numeric(df["analysis_revision"], errors="coerce").fillna(0).to_numpy()
    else:
        analysis_rev = np.zeros(len(df), dtype=float)

    path_rev = df["source_result_file"].map(path_revision).to_numpy()
    df["_fgj_revision_rank"] = np.maximum(analysis_rev, path_rev)

    df["_fgj_image_key"] = (
        df["_fgj_strain_id"]
        + "||"
        + df["_fgj_replicate_id"]
        + "||"
        + df["_fgj_date"].astype(str)
        + "||"
        + df["_fgj_image_file"]
    )

    max_revision = df.groupby("_fgj_image_key")["_fgj_revision_rank"].transform("max")
    resolved = df.loc[df["_fgj_revision_rank"] == max_revision].copy()

    # Keep audit-friendly metadata in the public output, but hide the internal
    # normalization helpers used only for revision resolution.
    resolved["resolved_revision_rank"] = resolved["_fgj_revision_rank"].astype(int)

    helper_cols = [
        "_fgj_strain_id",
        "_fgj_replicate_id",
        "_fgj_date",
        "_fgj_image_file",
        "_fgj_revision_rank",
        "_fgj_image_key",
    ]
    resolved.drop(columns=helper_cols, inplace=True, errors="ignore")

    summary = {
        "date_column": date_col,
        "strain_column": strain_col,
        "replicate_column": replicate_col,
        "image_column": image_col or "<source filename>",
        "raw_rows": int(len(raw)),
        "resolved_rows": int(len(resolved)),
        "raw_unique_images": int(df["_fgj_image_key"].nunique()),
        "resolved_unique_images": int(df.loc[resolved.index, "_fgj_image_key"].nunique()),
        "revision_rows_removed": int(len(raw) - len(resolved)),
        "revision_levels": sorted(int(x) for x in pd.unique(df["_fgj_revision_rank"]) if pd.notna(x)),
    }
    return resolved, summary


def write_csv(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False, encoding="utf-8-sig")


def main() -> int:
    args = parse_args()
    input_path = args.input_path
    output_dir = args.output_dir

    if not input_path.exists():
        print(f"ERROR: input does not exist: {input_path}", file=sys.stderr)
        return 1

    try:
        frames, files_found, skipped = load_result_frames(input_path)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    if not files_found:
        print(
            f"ERROR: no files matching '*_FungiGrowthJ_results.csv' were found in {input_path}",
            file=sys.stderr,
        )
        return 1

    if not frames:
        print("ERROR: all matching CSV files failed to load.", file=sys.stderr)
        for item in skipped:
            print("  -", item, file=sys.stderr)
        return 1

    raw = pd.concat(frames, ignore_index=True, sort=False)

    try:
        resolved, summary = resolve_revisions(raw)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR while resolving revisions: {exc}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)
    raw_path = output_dir / OUTPUT_RAW
    resolved_path = output_dir / OUTPUT_RESOLVED

    write_csv(raw, raw_path)
    write_csv(resolved, resolved_path)

    print("\nFungiGrowthJ result merge completed")
    print("---------------------------------")
    print(f"Input:                  {input_path.resolve()}")
    print(f"Result CSVs found:      {len(files_found)}")
    print(f"Result CSVs read:       {len(frames)}")
    print(f"Result CSVs skipped:    {len(skipped)}")
    print(f"Raw rows:               {summary['raw_rows']}")
    print(f"Resolved rows:          {summary['resolved_rows']}")
    print(f"Unique images (raw):    {summary['raw_unique_images']}")
    print(f"Unique images (resolved): {summary['resolved_unique_images']}")
    print(f"Revision levels found:  {summary['revision_levels']}")
    print(f"Date column:            {summary['date_column']}")
    print(f"Strain column:          {summary['strain_column']}")
    print(f"Replicate column:       {summary['replicate_column']}")
    print(f"Image column:           {summary['image_column']}")
    print(f"\nRaw output:             {raw_path.resolve()}")
    print(f"Resolved output:        {resolved_path.resolve()}")

    if skipped:
        print("\nSkipped files:")
        for item in skipped:
            print("  -", item)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
