# Audiobook Pipeline

Turns an EPUB into a chapter-tagged `.m4b` audiobook using local text-to-speech (Kokoro). A second path repackages an already-narrated YouTube playlist into the same kind of `.m4b`. Everything runs on your own machine.

## How it works

- `epub_extract.py` reads the EPUB, uses the table of contents when it is usable, and strips front matter and box-outs to get chapter text.
- `segment.py` splits long chapters into balanced chunks at paragraph boundaries (target around 15 to 20 minutes, hard ceiling 30).
- `synthesize.py` runs Kokoro per segment with longer pauses between paragraphs than between sentences. `normalize.py` levels the loudness.
- `validate.py` re-transcribes each segment with faster-whisper and writes a warning log for long runs of missing words. It never blocks the build.
- `package.py` concatenates the segments into one `.m4b` with chapter markers and cover art.
- `run_book.py` does one book end to end and is resumable. A segment that fails three times in a row stops the run. `run_queue.py` runs several books in a row and waits while OBS is open.
- `run_youtube.py` and `extract_youtube.py` do the playlist path (yt-dlp download, no TTS, no validation).
- `voice_audition.py` renders a sample passage in several Kokoro voices so you can pick one.

## Setup and run

```
python -m venv venv
venv\Scripts\pip install kokoro soundfile numpy ebooklib beautifulsoup4 faster-whisper yt-dlp
venv\Scripts\python.exe run_book.py "path\to\book.epub" [voice]
venv\Scripts\python.exe run_queue.py af_heart "a.epub" "b.epub"
venv\Scripts\python.exe run_youtube.py "<playlist url>" "<title>" ["<author>"]
```

Environment variables (both optional):

- `AUDIOBOOK_OUT_DIR`: where finished books go (default `~/Audiobooks`).
- `AUDIOBOOK_WORK_DIR`: scratch space for normalized segments (default `./_work`). Keep it out of any folder a sync client watches.

## Requirements

Python 3.10+, ffmpeg and ffprobe on PATH, a CUDA GPU for the faster-whisper validation step (Kokoro also runs on CPU, slowly). A few places use Windows-only calls such as `tasklist`.
