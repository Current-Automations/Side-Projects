"""Ingestion modules for external sources.

This module contains functions to ingest media from various sources
into the Da Clippaz pipeline. Supports YouTube and Twitch via yt-dlp.
"""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

try:
    import yt_dlp  # type: ignore
except ImportError:
    yt_dlp = None

from ..ffmpeg_utils import probe_duration
from .jobs import create_job, new_job_id
from .runner import process_job


def download_video(
    url: str,
    download_dir: Path,
    progress: Optional[Callable[[str], None]] = None,
) -> Tuple[Path, str, float]:
    """Download a video from YouTube or Twitch using yt-dlp.

    Parameters
    ----------
    url : str
        Video URL. Supports YouTube and Twitch (any platform yt-dlp handles).
    download_dir : Path
        Directory to place the downloaded file.
    progress : callable, optional
        Called with human-readable progress strings during the download.

    Returns
    -------
    tuple of (Path, str, float)
        Path to the downloaded file, video title, duration in seconds.
    """
    download_dir.mkdir(parents=True, exist_ok=True)
    output_template = download_dir / "%(id)s.%(ext)s"

    hooks: list = []
    if progress:
        def _hook(d: Dict[str, Any]) -> None:
            if d["status"] == "downloading":
                pct = d.get("_percent_str", "").strip()
                speed = d.get("_speed_str", "").strip()
                progress(f"  Downloading... {pct} at {speed}")
            elif d["status"] == "finished":
                progress("  Download finished. Merging streams...")
        hooks.append(_hook)

    ydl_opts: Dict[str, Any] = {
        "outtmpl": str(output_template),
        "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
        "merge_output_format": "mp4",
        "quiet": True,
        "progress_hooks": hooks,
    }

    info: Dict[str, Any] = {}

    if yt_dlp is not None:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True) or {}
    else:
        cmd = [
            "yt-dlp",
            "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
            "--merge-output-format", "mp4",
            "-o", str(output_template),
            url,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"yt-dlp failed: {result.stderr.strip()}")

        meta_cmd = ["yt-dlp", "-j", url]
        meta_res = subprocess.run(meta_cmd, capture_output=True, text=True)
        if meta_res.returncode == 0:
            try:
                info = json.loads(meta_res.stdout)
            except json.JSONDecodeError:
                info = {}

    title = str(info.get("title") or "video")
    duration = float(info.get("duration") or 0.0)
    video_id = str(info.get("id") or "")

    # Locate the downloaded file
    candidates: list = (
        list(download_dir.glob(f"{video_id}.*")) if video_id
        else list(download_dir.glob("*.mp4"))
    )
    if not candidates:
        candidates = [p for p in download_dir.iterdir() if p.is_file()]
    if not candidates:
        raise RuntimeError("Downloaded video file not found in download directory.")

    candidates.sort(key=lambda p: p.stat().st_size, reverse=True)
    source_path = candidates[0]

    if duration <= 0:
        duration = probe_duration(source_path)

    logger.info("Downloaded '%s' to %s (%.0fs)", title, source_path, duration)
    return source_path, title, duration


def _download_youtube(url: str, output_template: Path) -> Dict[str, Any]:
    """Download a YouTube video using yt-dlp.

    Returns metadata dictionary from yt-dlp.
    """
    info: Dict[str, Any] = {}

    if yt_dlp is not None:
        ydl_opts = {
            "outtmpl": str(output_template),
            "format": "bestvideo+bestaudio/best",
            "quiet": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
    else:
        cmd = [
            "yt-dlp",
            "-f",
            "bestvideo+bestaudio/best",
            "-o",
            str(output_template),
            url,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"yt-dlp failed: {result.stderr.strip()}")

        meta_cmd = ["yt-dlp", "-j", url]
        meta_res = subprocess.run(meta_cmd, capture_output=True, text=True)
        if meta_res.returncode == 0:
            try:
                info = json.loads(meta_res.stdout)
            except json.JSONDecodeError:
                info = {}

    return info


def ingest_youtube(url: str, config: Dict[str, Any]) -> None:
    """Download a video, create a job for it, and clip it."""

    jobs_root = Path(config["jobs_root"])
    jobs_root.mkdir(parents=True, exist_ok=True)

    job_id = new_job_id()
    job_dir = jobs_root / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    logger.info("Downloading video from %s", url)

    # IMPORTANT: extension-agnostic output template
    output_template = job_dir / "source.%(ext)s"

    info = _download_youtube(url, output_template)

    # Detect actual downloaded file
    downloaded_files = list(job_dir.glob("source.*"))
    if not downloaded_files:
        raise RuntimeError("Downloaded video file not found.")

    # If multiple formats exist, prefer largest file
    downloaded_files.sort(key=lambda p: p.stat().st_size, reverse=True)
    source_path = downloaded_files[0]

    # Metadata extraction
    title = info.get("title") or ""
    uploader = info.get("uploader") or ""
    duration = info.get("duration")

    if duration is None and "duration_string" in info:
        parts = info["duration_string"].split(":")
        secs = 0
        for part in parts:
            secs = secs * 60 + int(part)
        duration = secs

    if duration is None:
        duration = probe_duration(source_path)

    # The download and the clipping are two different jobs. Clipping here and
    # then writing status "pending" meant the runner picked the same job up and
    # cut every clip a second time, overwriting the first set. Ingest now only
    # creates the job, and the runner is the single place clipping happens.
    job_dir = create_job(
        source_path,
        config,
        float(duration),
        metadata={
            "title": title,
            "uploader": uploader,
            "source_url": url,
            "source": "youtube",
        },
        job_id=job_id,
    )

    (job_dir / "logs.txt").write_text(
        f"Downloaded {url} to {source_path}\n", encoding="utf-8"
    )

    logger.info("Ingested %s into job %s", url, job_id)
    process_job(job_dir, config)
