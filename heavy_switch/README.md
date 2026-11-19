# Heavy Switch

A small on/off switch for GPU-heavy background jobs (Whisper transcription, speaker ID, a local LLM) so they only run when you allow it. A runner process does the queued work one job at a time, pings a Discord webhook with the result, and can put the PC to sleep when the queue is empty.

This was built around one specific podcast-ingest app and is not a standalone tool. It expects a separate app directory (`POD_APP_DIR`) with a SQLite database and a `scripts/pull_podcasts.py` script, neither of which is in this repo. Read it as an example of a guarded job runner, not something to run as is.

## How it works

- `heavyswitch.py` holds the state in `state.json` (on/off, day or night mode, optional episode ids or league filter). `on`, `off`, `toggle` and `status` are CLI commands. It is stdlib only.
- `on --night` sets a stop time of 08:00. Turning the switch off also unloads any models Ollama still holds in video memory.
- `runner.py` is started by `turn_on`, never by a timer. It takes a lock file so two quick presses do not start two runners.
- Before each job it checks three things: OBS is not running (it waits and says so on Discord), no other podcast run holds the lock file, and the GPU has at least 4 GB free (otherwise it stops and says why).
- Night mode runs the podcast queue including the backlog, then the Rebuild job in `../podcast_rebuild`. When both queues are empty it sleeps the PC.
- Time estimates come from the median of recent timings stored in the app database, with fixed fallbacks.

## Setup and run

```
py -3 heavyswitch.py status
py -3 heavyswitch.py on --night
py -3 heavyswitch.py off
```

Set the variables listed in `.env.example` in the environment that launches the switch. Nothing reads the `.env` file automatically.

## Requirements

Windows (uses `tasklist`, `nvidia-smi`, `pythonw.exe`), Python 3.10+, an Ollama server on `localhost:11434`, and the external podcast app described above.
