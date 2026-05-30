"""Pipeline runner for Da Clippaz.

The runner orchestrates processing of jobs through various stages.  In
PR1 it performs no real work; it logs that the pipeline would run.

Future milestones will extend this to iterate over job folders,
manage state transitions, invoke stages, handle retries and write
status and metadata files to disk.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict

from .segmentation import compute_clip_windows, run_clipping

logger = logging.getLogger(__name__)


def _write_status(status_path: Path, state: str, retries: int) -> None:
    status_path.write_text(
        json.dumps({"state": state, "retries": retries}, indent=2),
        encoding="utf-8",
    )

def run_pipeline(config: Dict[str, Any]) -> None:
    """
    Legacy run command support.
    In PR3, most processing happens through the watcher.
    This function exists to prevent CLI import errors.
    """
    logger.info("run command invoked. No-op in PR3. Use watch instead.")


def process_job(job_dir: Path, config: Dict[str, Any]) -> None:
    job_path = job_dir / "job.json"
    status_path = job_dir / "status.json"
    clips_dir = job_dir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    if not job_path.exists():
        logger.warning("Missing job.json in %s, skipping", job_dir)
        return

    job = json.loads(job_path.read_text(encoding="utf-8"))

    # Read current status
    retries = 0
    if status_path.exists():
        try:
            status = json.loads(status_path.read_text(encoding="utf-8"))
            retries = int(status.get("retries", 0))
        except Exception:
            retries = 0

    max_retries = int(config.get("retries", {}).get("max_retries", 3))

    # Transition to processing
    _write_status(status_path, "processing", retries)

    try:
        source_path = Path(job["source_path"])

        if not source_path.exists():
            # Try auto-detecting any source file in job folder
            candidates = list(job_dir.glob("source.*"))
            if candidates:
                source_path = candidates[0]
            else:
                raise RuntimeError(f"Source file not found for job {job_dir.name}")
            
        params = job.get("parameters", config.get("clip_settings", {}))

        clip_length = int(params["clip_length_seconds"])
        overlap = int(params["overlap_seconds"])
        max_clips = int(params.get("max_clips_per_video", config.get("clip_settings", {}).get("max_clips_per_video", 20)))

        # Duration comes from job metadata if available
        duration = job.get("metadata", {}).get("duration")
        if duration is None:
            raise RuntimeError("Job metadata missing duration")

        windows = compute_clip_windows(float(duration), clip_length, overlap, max_clips)
        clip_paths = run_clipping(source_path, windows, clips_dir, config.get("tiktok", {}))

        # Completed
        _write_status(status_path, "completed", retries)

        logger.info("Job completed: %s clips=%d", job_dir.name, len(clip_paths))

    except Exception as exc:
        retries += 1
        if retries < max_retries:
            _write_status(status_path, "pending", retries)
            logger.exception("Job failed, will retry. job=%s retries=%d", job_dir.name, retries)
        else:
            _write_status(status_path, "failed", retries)
            logger.exception("Job failed permanently. job=%s retries=%d", job_dir.name, retries)
