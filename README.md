# Side Projects

Standalone projects for Current Automations that don't belong in the marketing
site repo.

## Contents

- **`job_scout/`**: a daily job-search automation that finds matching postings,
  removes duplicates and logs each one for review (never applies). The folder
  keeps the first two versions; the live one is now a Claude skill. See
  [`job_scout/README.md`](job_scout/README.md).
- **`audiobook_pipeline/`**: turns an EPUB into a chapter-tagged m4b with local
  Kokoro text-to-speech, plus a path for repackaging already-narrated YouTube
  playlists. See [`audiobook_pipeline/README.md`](audiobook_pipeline/README.md).
- **`heavy_switch/`**: an on/off switch and runner for GPU-heavy background
  jobs, with OBS and free-VRAM guards and Discord status pings. Tied to an
  external podcast app, so read it as an example. See
  [`heavy_switch/README.md`](heavy_switch/README.md).
- **`dictate/`**: a local push-to-talk dictation tool for Windows
  (faster-whisper plus an Ollama cleanup pass, per-app tone). See
  [`dictate/README.md`](dictate/README.md).
- **`podcast_rebuild/`**: rebuilds podcast notes in a markdown vault into a hub
  note plus per-segment deep dives from transcripts. See
  [`podcast_rebuild/README.md`](podcast_rebuild/README.md).
