"""Job folder creation and naming.

A job folder is the unit of work: it holds the source video, the parameters it
should be cut with, and a status file that survives a crash. Both entry points
build one the same way, whether the source arrived as a file dropped in
``input_dir`` or as a YouTube download.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

# What the watcher will pick up out of input_dir.
VIDEO_SUFFIXES = {".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v", ".ts", ".flv"}

_SLUG_STRIP = re.compile(r"[^a-zA-Z0-9]+")


def slugify(text: str, max_length: int = 60) -> str:
    """Turn a video title into a safe folder name."""
    slug = _SLUG_STRIP.sub("-", text).strip("-").lower()
    if len(slug) <= max_length:
        return slug
    # Cut at the last whole word so the folder name still reads as the title
    # rather than ending mid-word.
    cut = slug[:max_length]
    if "-" in cut:
        cut = cut[: cut.rindex("-")]
    return cut.strip("-")


def new_job_id() -> str:
    return uuid.uuid4().hex[:12]


def create_job(
    source_path: Path,
    config: Dict[str, Any],
    duration: float,
    metadata: Optional[Dict[str, Any]] = None,
    job_id: Optional[str] = None,
    move_source: bool = False,
) -> Path:
    """Create a pending job folder for ``source_path``.

    With ``move_source`` the file is moved into the job folder, which is what
    the watcher wants so the same drop is not picked up twice.
    """
    jobs_root = Path(config["jobs_root"])
    job_id = job_id or new_job_id()
    job_dir = jobs_root / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    if move_source:
        target = job_dir / f"source{source_path.suffix.lower()}"
        source_path.replace(target)
        source_path = target

    meta = dict(metadata or {})
    meta["duration"] = duration

    job = {
        "job_id": job_id,
        "source_path": str(source_path.resolve()),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "priority": int(config.get("priority", 5)),
        "parameters": config.get("clip_settings", {}),
        "metadata": meta,
    }
    (job_dir / "job.json").write_text(json.dumps(job, indent=2), encoding="utf-8")
    (job_dir / "status.json").write_text(
        json.dumps({"state": "pending", "retries": 0}, indent=2), encoding="utf-8"
    )
    return job_dir


def publish_dir(config: Dict[str, Any], job_id: str, title: Optional[str]) -> Path:
    """Where finished clips for this job should end up.

    Named after the video, because the folder is a posting queue that gets
    opened by hand. A job id tells you nothing at that point.
    """
    root = Path(config["output_dir"])
    name = slugify(title) if title else ""
    return root / (f"{name}-{job_id[:6]}" if name else job_id)
