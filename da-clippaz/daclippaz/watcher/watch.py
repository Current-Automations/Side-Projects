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


def watch(config: Dict[str, Any]) -> None:
    jobs_root = Path(config["jobs_root"])
    jobs_root.mkdir(parents=True, exist_ok=True)

    poll = int(config.get("watcher", {}).get("poll_interval_seconds", 5))
    if poll < 1:
        poll = 1

    logger.info("Watcher started. jobs_root=%s poll_interval_seconds=%s", jobs_root, poll)

    try:
        while True:
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
