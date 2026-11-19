"""Convert a list of EPUBs one after another, unattended.

Usage: python run_queue.py <voice> "<epub>" "<epub>" ...

Holds the PC awake only while it runs. Waits between books while OBS is open, so the GPU is free for recording.
A book that fails is logged and the next one still runs. A finished book is skipped on a rerun.
"""
import ctypes
import datetime as dt
import os
import subprocess
import sys
import time
from pathlib import Path

from epub_extract import read_metadata, safe_name

HERE = Path(__file__).parent
OUT_ROOT = Path(os.environ.get("AUDIOBOOK_OUT_DIR", str(Path.home() / "Audiobooks")))
LOG = HERE / "queue.log"
KEEP_AWAKE, RELEASE = 0x80000001, 0x80000000


def log(line):
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} {line}\n")


def obs_open():
    out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq obs64.exe"], capture_output=True, text=True).stdout
    return "obs64.exe" in out


def main(voice, epubs):
    ctypes.windll.kernel32.SetThreadExecutionState(KEEP_AWAKE)
    log(f"queue start: {len(epubs)} books, voice {voice}")
    try:
        for epub in epubs:
            meta = read_metadata(Path(epub))
            name = safe_name(f"{meta['title']} - {meta['author']}" if meta["author"] else meta["title"])
            if (OUT_ROOT / name / f"{name}.m4b").exists():
                log(f"skip, already made: {name}")
                continue
            while obs_open():
                log("waiting: OBS is open")
                time.sleep(300)
            log(f"start: {name}")
            t0 = time.time()
            with LOG.open("a", encoding="utf-8") as f:
                code = subprocess.run([sys.executable, "-X", "utf8", str(HERE / "run_book.py"), epub, voice], cwd=HERE, stdout=f, stderr=subprocess.STDOUT).returncode
            log(f"{'done' if code == 0 else f'FAILED exit {code}'}: {name} in {(time.time() - t0) / 60:.0f} min")
    finally:
        ctypes.windll.kernel32.SetThreadExecutionState(RELEASE)
        log("queue end")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
