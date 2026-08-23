"""Pipeline runner for Da Clippaz.

``process_job`` takes one job folder from pending to completed or failed,
writing ``status.json`` at each transition so a crash mid-run is recoverable.
``run_pipeline`` drains every pending job in ``jobs_root`` once and returns,
which is what a scheduled run wants rather than a process that never exits.
"""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Any, Dict

from .jobs import publish_dir
from .segmentation import compute_clip_windows, run_clipping

logger = logging.getLogger(__name__)


def _write_status(status_path: Path, state: str, retries: int, **extra: Any) -> None:
    payload = {"state": state, "retries": retries}
    payload.update(extra)
    status_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

def _publish_clips(
    clip_paths: list[Path],
    config: Dict[str, Any],
    job_id: str,
    title: str | None,
) -> Path:
    """Move finished clips out of the job folder into ``output_dir``.

    The job folder is working state: a big source file, json, scratch. What
    gets posted should sit in one clean folder named after the video, or the
    posting step means digging through uuids to find the clips.
    """
    target = publish_dir(config, job_id, title)
    target.mkdir(parents=True, exist_ok=True)
    for clip in clip_paths:
        clip.replace(target / clip.name)
        try:
            clip.parent.rmdir()
        except OSError:
            pass
    return target


def _job_priority(job_path: Path) -> int:
    try:
        data = json.loads(job_path.read_text(encoding="utf-8"))
        return int(data.get("priority", 5))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return 5


def run_pipeline(config: Dict[str, Any]) -> int:
    """Process every pending job in ``jobs_root`` once, then return.

    Returns the number of jobs processed.
    """
    jobs_root = Path(config["jobs_root"])
    jobs_root.mkdir(parents=True, exist_ok=True)

    pending = []
    for job_dir in sorted(jobs_root.iterdir()):
        if not job_dir.is_dir() or not (job_dir / "job.json").exists():
            continue
        status_path = job_dir / "status.json"
        state = "pending"
        if status_path.exists():
            try:
                state = str(json.loads(status_path.read_text(encoding="utf-8")).get("state", "pending")).lower()
            except json.JSONDecodeError:
                state = "pending"
        if state == "pending":
            pending.append((_job_priority(job_dir / "job.json"), job_dir))

    if not pending:
        logger.info("No pending jobs in %s", jobs_root)
        return 0

    pending.sort(key=lambda item: (item[0], item[1].name))
    logger.info("Processing %d pending job(s) in %s", len(pending), jobs_root)

    for _, job_dir in pending:
        try:
            process_job(job_dir, config)
        except Exception:
            logger.exception("Unexpected error while processing job: %s", job_dir)

    return len(pending)


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

        clip_settings = config.get("clip_settings", {})
        clip_format = params.get("format", clip_settings.get("format", "parts"))
        min_tail = int(params.get("min_tail_seconds", clip_settings.get("min_tail_seconds", 10)))
        source_title = job.get("metadata", {}).get("title")

        windows = compute_clip_windows(
            float(duration), clip_length, overlap, max_clips, min_tail
        )
        clip_paths = run_clipping(
            source_path,
            windows,
            clips_dir,
            config.get("tiktok", {}),
            clip_format=clip_format,
            captions_cfg=config.get("captions", {}),
            encoder_cfg=config.get("encoder", {}),
            source_title=source_title,
            temp_dir=Path(config["temp_dir"]) / job_dir.name,
        )

        # A run that produced no clips is a failure, not a completion. Marking
        # it completed would hide a broken encoder or a dead model file behind
        # a green status and leave an empty clips folder nobody checks.
        if windows and not clip_paths:
            raise RuntimeError(
                f"No clips produced from {len(windows)} window(s); see errors above"
            )

        # A partial render is not a clean success. Losing parts 2 and 3 of a
        # series breaks it, so the shortfall goes in the status file and the
        # log rather than being averaged away into "completed".
        if len(clip_paths) < len(windows):
            logger.warning(
                "Job %s produced %d of %d clips; some windows failed",
                job_dir.name,
                len(clip_paths),
                len(windows),
            )

        published = _publish_clips(clip_paths, config, job_dir.name, source_title)
        shutil.rmtree(Path(config["temp_dir"]) / job_dir.name, ignore_errors=True)
        _write_status(
            status_path,
            "completed",
            retries,
            clips_expected=len(windows),
            clips_produced=len(clip_paths),
            output_dir=str(published),
        )

        logger.info(
            "Job completed: %s clips=%d ready to post in %s",
            job_dir.name,
            len(clip_paths),
            published,
        )

    except Exception as exc:
        retries += 1
        if retries < max_retries:
            _write_status(status_path, "pending", retries)
            logger.exception("Job failed, will retry. job=%s retries=%d", job_dir.name, retries)
        else:
            _write_status(status_path, "failed", retries)
            logger.exception("Job failed permanently. job=%s retries=%d", job_dir.name, retries)
