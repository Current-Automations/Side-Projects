# Podcast Rebuild

Rebuilds podcast notes in a markdown vault (Obsidian) into a hub note plus one deep-dive note per segment. For each queued episode it gets a transcript, splits it into segments, has a local model write each segment note, drops any quote that does not appear in the transcript, and has Claude write the hub note.

It assumes a particular vault layout (`Knowledge/Podcasts/<show>/<episode>.md` and a `Rebuild Queue.md` checklist under `NOTES_DIR`), so it is a worked example more than a drop-in tool.

## How it works

- Reads unchecked `- [ ] [[Episode name]]` lines from `Rebuild Queue.md` and marks each one done, or failed with the reason.
- Transcript source, in order: YouTube captions via yt-dlp, then the show's RSS audio transcribed with faster-whisper, then YouTube audio with faster-whisper.
- Long episodes are split on YouTube chapters (merged to at least 12 minutes). Short ones, or ones without chapters, are split evenly.
- Each segment goes to a local Ollama model with a fixed note template. Quotes are checked against the segment text and unverified ones are removed.
- The hub note is written by the `claude` CLI (`claude -p`) from the old note plus the segment notes, keeping anything handwritten in the old note.
- Waits while OBS is open, honours a stop time (`--until HH:MM`), and can follow the switch in `../heavy_switch` (`--switch`).
- `feeds.py` fetches RSS item lists into `feeds.json`, used to find release dates and audio when YouTube has nothing.

## Setup and run

```
pip install requests faster-whisper yt-dlp
set NOTES_DIR=path\to\your\vault
copy feeds_sources.example.json feeds_sources.json
copy hosts.example.json hosts.json
py -3 feeds.py
py -3 rebuild.py --note "<episode note name>" --dry-run
py -3 rebuild.py --limit 3
```

`feeds_sources.json` maps a show name (the show's folder name in the vault) to an RSS url or a list of urls. `hosts.json` maps a show name to host names and is optional.

## Requirements

Windows, Python 3.10+, ffmpeg, an Ollama server with the model named in `rebuild.py`, the `claude` CLI on PATH, and an NVIDIA GPU for the Whisper fallback.
