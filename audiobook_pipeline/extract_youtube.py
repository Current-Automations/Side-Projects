"""YouTube playlist -> ordered list of {"title": str, "audio": Path} chapters.

No TTS -- this is for narration that already exists (a free course, a ripped
lecture series) where the book front end would be redundant. Each video is
one chapter. Long videos get split at silence boundaries in segment_audio.py
rather than paragraph boundaries, since there's no text to split on.

Audio is kept in its native container (webm/opus or m4a); ffmpeg reads it
directly downstream, so there's no point decoding 9 hours to wav on disk.
A download archive makes re-runs skip finished videos.
"""
import re
import subprocess
import sys
from pathlib import Path

# Invoke via the current interpreter's yt_dlp module, not the "yt-dlp" console
# script -- that launcher's embedded interpreter path is broken on this
# machine (ModuleNotFoundError at runtime despite yt-dlp working from a shell).
YTDLP = [sys.executable, "-m", "yt_dlp"]
AUDIO_EXTS = {".webm", ".m4a", ".opus", ".mp3", ".ogg", ".wav", ".mp4"}


def _clean_label(stem: str) -> str:
    title = re.sub(r"\s+", " ", stem).strip()
    return title


def download_playlist(url: str, out_dir: Path) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        [
            *YTDLP, "-f", "bestaudio/best", "--no-progress",
            "--download-archive", str(out_dir / "archive.txt"),
            "-o", str(out_dir / "%(playlist_index)03d - %(title)s.%(ext)s"),
            url,
        ],
        check=True,
    )

    files = sorted(p for p in out_dir.iterdir() if p.suffix.lower() in AUDIO_EXTS)
    chapters = []
    for f in files:
        stem = f.stem
        m = re.match(r"^(\d{3}) - (.*)$", stem)
        idx = int(m.group(1)) if m else len(chapters) + 1
        title = _clean_label(m.group(2) if m else stem)
        chapters.append({"title": f"{idx}. {title}", "audio": f})
    return chapters


if __name__ == "__main__":
    url = sys.argv[1]
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("./yt_download")
    chapters = download_playlist(url, out_dir)
    for i, ch in enumerate(chapters, 1):
        print(f"{i:2d}. {ch['title']!r} -> {ch['audio']}")
