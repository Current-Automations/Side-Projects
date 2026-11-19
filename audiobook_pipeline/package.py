"""Concatenate normalized segment wavs into a single m4b with chapter markers,
title/author tags and (when the EPUB has one) embedded cover art."""
import subprocess
from pathlib import Path

import soundfile as sf

COVER_EXTS = {"jpg", "jpeg", "png"}


def _write_concat_list(wav_paths: list[Path], list_path: Path):
    with open(list_path, "w", encoding="utf-8") as f:
        for p in wav_paths:
            # ffmpeg concat demuxer file paths must be escaped for single quotes
            escaped = str(p.resolve()).replace("'", "'\\''")
            f.write(f"file '{escaped}'\n")


def _write_chapters_metadata(labels: list[str], durations_ms: list[int], meta_path: Path):
    lines = [";FFMETADATA1"]
    start = 0
    for label, dur in zip(labels, durations_ms):
        end = start + dur
        lines.append("[CHAPTER]")
        lines.append("TIMEBASE=1/1000")
        lines.append(f"START={start}")
        lines.append(f"END={end}")
        lines.append("title=" + label.replace("\\", "\\\\").replace("=", "\\=").replace(";", "\\;").replace("#", "\\#"))
        start = end
    meta_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def package_m4b(wav_paths: list[Path], labels: list[str], out_path: Path, work_dir: Path,
                title: str = "", author: str = "", cover: tuple[str, bytes] | None = None):
    assert len(wav_paths) == len(labels)
    work_dir.mkdir(parents=True, exist_ok=True)

    durations_ms = [round(sf.info(str(p)).duration * 1000) for p in wav_paths]

    concat_list = work_dir / "concat_list.txt"
    _write_concat_list(wav_paths, concat_list)

    intermediate_m4a = work_dir / "concat.m4a"
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
            "-i", str(concat_list), "-c:a", "aac", "-b:a", "96k", str(intermediate_m4a),
        ],
        check=True,
    )

    chapters_meta = work_dir / "chapters.txt"
    _write_chapters_metadata(labels, durations_ms, chapters_meta)

    cover_path = None
    if cover and cover[0].lower() in COVER_EXTS:
        cover_path = work_dir / f"cover.{cover[0].lower()}"
        cover_path.write_bytes(cover[1])

    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(intermediate_m4a), "-i", str(chapters_meta)]
    if cover_path:
        cmd += ["-i", str(cover_path)]
    # -map_chapters is explicit because ffmpeg otherwise keeps the chapters of
    # the first input that has any; bit us when remuxing an existing m4b.
    cmd += ["-map", "0:a", "-map_metadata", "1", "-map_chapters", "1", "-codec", "copy"]
    if cover_path:
        cmd += ["-map", "2:v", "-disposition:v:0", "attached_pic"]
    if title:
        cmd += ["-metadata", f"title={title}", "-metadata", f"album={title}"]
    if author:
        cmd += ["-metadata", f"artist={author}", "-metadata", f"album_artist={author}"]
    cmd += ["-metadata", "genre=Audiobook", "-f", "mp4", str(out_path)]
    subprocess.run(cmd, check=True)

    return out_path, sum(durations_ms) / 1000 / 60
