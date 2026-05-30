# Da Clippaz

Da Clippaz is a local video clipping pipeline built in Python.  Its goal is to provide a reliable, unattended way to process long-form recordings into short clips suitable for platforms such as TikTok.  The system watches an input directory for new recordings, splits them into overlapping clips on a fixed schedule and produces vertical 9:16 exports.  A modular architecture makes it easy to add more sophisticated features like highlight detection or scoring without rewriting the core pipeline.

## Status

This repository currently contains the initial scaffold (milestone PR1).  The primary focus of this milestone is to set up a clean package structure, provide a command‑line interface and verify that the required runtime dependencies (Python 3.12 and FFmpeg) are available.  Future milestones will add the actual pipeline stages, a directory watcher, exporters and more comprehensive tests.

## Quick start

### Prerequisites

1. Install **Python 3.12** on your machine.  The first version targets Python 3.12; it may work on Python 3.13, but compatibility is not guaranteed yet.
2. Install **FFmpeg** and ensure it is available on your system `PATH`.  The CLI will attempt to run `ffmpeg -version` and will exit with a clear error if FFmpeg is not found.

### Installation

Clone this repository and create a virtual environment:

```
powershell
python3.12 -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

Copy the example configuration to a working config file and edit paths as needed:

```
powershell
copy configs\config.example.json configs\config.json
# Edit configs\config.json to point to your input/output/temp directories
```

### Usage

Two subcommands are provided via the Python module entrypoint:

```
powershell
python -m daclippaz run --config configs\config.json
python -m daclippaz watch --config configs\config.json
```

* `run`: run the clipping pipeline on jobs that already exist.  In this first milestone it simply verifies your configuration and FFmpeg installation.
* `watch`: watch the configured input directory for new recordings.  A proper watcher will be added in a later milestone; in PR1 this is a placeholder.

### Project layout

The code is organised as a package under `daclippaz/`.  Each submodule has a clear responsibility:

| Folder / file          | Purpose                                                     |
|----------------------- |-------------------------------------------------------------|
| `daclippaz/cli.py`     | Command‑line interface and argument parsing                 |
| `daclippaz/config.py`  | Loading and validating JSON configuration files             |
| `daclippaz/logging_utils.py` | Configure Python logging based on the config              |
| `daclippaz/ffmpeg_utils.py`  | Check that FFmpeg is installed and available on the PATH |
| `daclippaz/pipeline/`  | Pipeline definitions (job model, stages, runner)           |
| `daclippaz/watcher/`   | Placeholder for directory watching logic                    |
| `daclippaz/exporters/` | Future exporters (e.g. TikTok vertical video)              |
| `daclippaz/detectors/` | Placeholders for highlight or score detection              |
| `configs/`             | Example configuration files                                 |
| `docs/`                | High‑level documentation for the codebase                   |
| `tests/`               | Unit and integration tests                                  |

### Contributing and roadmap

Contributions are tracked through pull requests per milestone.  The rough roadmap is:

1. **PR1** – this scaffold, CLI skeleton, configuration validation and FFmpeg detection.
2. **PR2** – implement the job model, pipeline runner and fixed‑interval clipping stage.
3. **PR3** – add a watcher that creates jobs from dropped files and implements state persistence and retry logic.
4. **PR4** – implement the TikTok exporter (crop and blur modes) and write integration tests using synthetic videos.
5. **PR5** – finish documentation and publish a comprehensive runbook and technical specification in Notion (links will be added to `docs/ARCHITECTURE.md`).
