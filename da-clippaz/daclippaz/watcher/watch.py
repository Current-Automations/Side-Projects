"""Directory watcher for Da Clippaz.

The watcher monitors the configured input directory for new video
files, creates job folders and enqueues jobs for processing. It polls
``jobs_root`` on an interval, picks up anything in the ``pending`` state and
hands it to the runner, lowest priority number first.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Dict

from daclippaz.ffmpeg_utils import probe_duration
from daclippaz.pipeline.jobs import VIDEO_SUFFIXES, create_job
from daclippaz.pipeline.runner import process_job

logger = logging.getLogger(__name__)


def _load_status(status_path: Path) -> Dict[str, Any]:
    try:
        with status_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"state": "pending", "retries": 0}
        if "state" not in data:
            data["state"] = "pending"
        if "retries" not in data:
            data["retries"] = 0
        return data
    except FileNotFoundError:
        return {"state": "pending", "retries": 0}
    except json.JSONDecodeError:
        return {"state": "pending", "retries": 0}


def _load_priority(job_path: Path) -> int:
    try:
        with job_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return 5
        priority = data.get("priority", 5)
        try:
            return int(priority)
        except (TypeError, ValueError):
            return 5
    except (FileNotFoundError, json.JSONDecodeError):
        return 5


def _adopt_dropped_files(config: Dict[str, Any], seen_sizes: Dict[Path, int]) -> int:
    """Turn video files dropped in ``input_dir`` into pending jobs.

    A file is only picked up once its size has stopped changing between polls,
    otherwise a job gets created around a copy that is still being written and
    the clip windows are computed from a truncated duration.
    """
    input_dir = Path(config["input_dir"])
    input_dir.mkdir(parents=True, exist_ok=True)

    created = 0
    for path in sorted(input_dir.iterdir()):
        if not path.is_file() or path.suffix.lower() not in VIDEO_SUFFIXES:
            continue

        try:
            size = path.stat().st_size
        except OSError:
            continue

        if seen_sizes.get(path) != size or size == 0:
            seen_sizes[path] = size
            logger.debug("Waiting for %s to finish copying (%d bytes)", path.name, size)
            continue

        seen_sizes.pop(path, None)
        try:
            duration = probe_duration(path)
            job_dir = create_job(
                path,
                config,
                duration,
                metadata={"title": path.stem, "source": "input_dir"},
                move_source=True,
            )
        except Exception:
            logger.exception("Could not create a job for %s", path)
            continue

        logger.info("Created job %s from %s", job_dir.name, path.name)
        created += 1

    return created


def watch(config: Dict[str, Any]) -> None:
    jobs_root = Path(config["jobs_root"])
    jobs_root.mkdir(parents=True, exist_ok=True)

    poll = int(config.get("watcher", {}).get("poll_interval_seconds", 5))
    if poll < 1:
        poll = 1

    logger.info(
        "Watcher started. input_dir=%s jobs_root=%s poll_interval_seconds=%s",
        Path(config["input_dir"]),
        jobs_root,
        poll,
    )

    seen_sizes: Dict[Path, int] = {}

    try:
        while True:
            _adopt_dropped_files(config, seen_sizes)

            pending_jobs = []
            logger.debug("Scanning %s for pending jobs", jobs_root)

            for job_dir in jobs_root.iterdir():
                if not job_dir.is_dir():
                    continue
                logger.debug("Found job dir: %s", job_dir)

                job_json = job_dir / "job.json"
                status_json = job_dir / "status.json"

                if not job_json.exists():
                    continue

                status = _load_status(status_json)
                state = str(status.get("state", "pending")).lower()
                logger.debug("Job %s state=%s", job_dir.name, state)

                if state == "pending":
                    priority = _load_priority(job_json)
                    pending_jobs.append((priority, job_dir))

            pending_jobs.sort(key=lambda item: (item[0], item[1].name))

            for _, job_dir in pending_jobs:
                try:
                    logger.info("Processing job: %s", job_dir.name)
                    process_job(job_dir, config)
                except Exception:
                    logger.exception("Unexpected error while processing job: %s", job_dir)

            time.sleep(poll)

    except KeyboardInterrupt:
        logger.info("Watcher stopped by user (KeyboardInterrupt).")
